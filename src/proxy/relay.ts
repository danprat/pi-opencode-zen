/**
 * Vercel Edge Relay Function template, header transformation, and proxy-aware fetch.
 */

import { RELAY_CONNECT_TIMEOUT_MS } from './types.ts';
import {
  getProxyConfig,
  getProxyStateSnapshot,
  recordRelayFailure,
  recordRelaySuccess,
  updateCircuitBreakerState,
} from './circuit.ts';

// Relay function deployed to Vercel Edge Runtime
export const RELAY_FUNCTION_CODE = `export const config = { runtime: "edge" };

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "*",
      },
    });
  }

  const target = req.headers.get("x-relay-target");
  if (!target) {
    return new Response(JSON.stringify({ error: "Missing x-relay-target header" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const relayPath = req.headers.get("x-relay-path") ||
    (url.pathname !== "/api/relay" ? url.pathname + url.search : "/");
  const targetUrl = target.replace(/\\/$/, "") + relayPath;

  const headers = new Headers(req.headers);
  headers.delete("x-relay-target");
  headers.delete("x-relay-path");
  headers.delete("host");

  const response = await fetch(targetUrl, {
    method: req.method,
    headers,
    body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
    duplex: "half",
  });

  const resHeaders = new Headers(response.headers);
  resHeaders.set("cache-control", "no-cache, no-transform");
  resHeaders.set("x-accel-buffering", "no");

  return new Response(response.body, {
    status: response.status,
    headers: resHeaders,
  });
}
`;

export function isOpencodeTarget(targetUrl: string | URL): boolean {
  try {
    return typeof targetUrl === 'string'
      ? targetUrl.includes('opencode.ai')
      : targetUrl.hostname.includes('opencode.ai');
  } catch {
    return false;
  }
}

export function buildRelayHeaders(
  targetUrl: string,
  baseHeaders?: HeadersInit,
): { targetOrigin: string; targetPath: string; headers: Record<string, string> } {
  const parsed = new URL(targetUrl);
  const targetOrigin = `${parsed.protocol}//${parsed.host}`;
  const targetPath = `${parsed.pathname}${parsed.search}`;

  const headers: Record<string, string> = {};

  if (baseHeaders instanceof Headers) {
    for (const [k, v] of baseHeaders.entries()) headers[k] = v;
  } else if (Array.isArray(baseHeaders)) {
    for (const [k, v] of baseHeaders) headers[k] = v;
  } else if (baseHeaders && typeof baseHeaders === 'object') {
    for (const [k, v] of Object.entries(baseHeaders)) {
      if (v !== undefined && v !== null) headers[k] = String(v);
    }
  }

  headers['x-relay-target'] = targetOrigin;
  headers['x-relay-path'] = targetPath;

  for (const k of Object.keys(headers)) {
    const lower = k.toLowerCase();
    if (
      lower === 'host' ||
      (lower === 'x-relay-target' && k !== 'x-relay-target') ||
      (lower === 'x-relay-path' && k !== 'x-relay-path')
    ) {
      delete headers[k];
    }
  }

  return { targetOrigin, targetPath, headers };
}

function isProxyErrorStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

export const originalFetch: typeof globalThis.fetch = globalThis.fetch;

export async function proxyAwareFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  customFetch?: typeof globalThis.fetch,
): Promise<Response> {
  const dispatchFetch = customFetch ?? globalThis.fetch;
  const targetUrl =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

  updateCircuitBreakerState();

  const currentConfig = getProxyConfig();
  const snapshot = getProxyStateSnapshot();

  const isRelayCandidate =
    currentConfig.enabled && Boolean(currentConfig.relayUrl) && isOpencodeTarget(targetUrl);

  if (!isRelayCandidate) {
    return dispatchFetch(input, init);
  }

  const allowFallback = currentConfig.fallback && !currentConfig.strictProxy;

  // Circuit breaker is open (cooling down): skip relay immediately
  if (snapshot.circuitState === 'OPEN') {
    if (!allowFallback) {
      throw new Error(
        `[Proxy] Vercel relay is unreachable (circuit open, cooling down) and strictProxy is enabled`,
      );
    }
    return dispatchFetch(input, init);
  }

  // Prepare relay request
  const { headers: relayHeaders } = buildRelayHeaders(targetUrl, init?.headers);
  const relayUrl = currentConfig.relayUrl;

  // Establish connection timer for fast-failover
  const connectController = new AbortController();
  const connectTimeout = setTimeout(() => {
    connectController.abort(new Error('Vercel relay initial connection timed out'));
  }, RELAY_CONNECT_TIMEOUT_MS);

  // Link caller signal if provided
  let onCallerAbort: (() => void) | undefined;
  if (init?.signal) {
    if (init.signal.aborted) {
      clearTimeout(connectTimeout);
      connectController.abort(init.signal.reason);
    } else {
      onCallerAbort = () => {
        clearTimeout(connectTimeout);
        connectController.abort(init?.signal?.reason);
      };
      init.signal.addEventListener('abort', onCallerAbort, { once: true });
    }
  }

  try {
    const relayResponse = await dispatchFetch(relayUrl, {
      ...init,
      headers: relayHeaders,
      signal: connectController.signal,
      keepalive: true,
    });

    clearTimeout(connectTimeout);
    if (onCallerAbort && init?.signal) {
      init.signal.removeEventListener('abort', onCallerAbort);
    }

    // Check for relay-level failure
    const hasVercelErrorHeader = relayResponse.headers.has('x-vercel-error');
    if (isProxyErrorStatus(relayResponse.status) || hasVercelErrorHeader) {
      recordRelayFailure();
      if (!allowFallback) {
        throw new Error(
          `[Proxy] Vercel relay returned status ${relayResponse.status}${
            hasVercelErrorHeader ? ' (x-vercel-error)' : ''
          } and strictProxy is enabled`,
        );
      }
      // Fallback seamlessly to direct connection
      return dispatchFetch(input, init);
    }

    // Success through relay
    recordRelaySuccess();
    return relayResponse;
  } catch (error) {
    clearTimeout(connectTimeout);
    if (onCallerAbort && init?.signal) {
      init.signal.removeEventListener('abort', onCallerAbort);
    }

    // If caller explicitly aborted the request, do not fallback
    if (init?.signal?.aborted) {
      throw error;
    }

    recordRelayFailure();

    if (!allowFallback) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`[Proxy] Vercel relay failed (${msg}) and strictProxy is enabled`, {
        cause: error,
      });
    }

    // Fallback seamlessly to direct connection
    return dispatchFetch(input, init);
  }
}
