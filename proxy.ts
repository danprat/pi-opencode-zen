/**
 * Vercel Edge Relay Proxy Integration for OpenCode Zen.
 *
 * Implements a serverless edge relay proxy inspired by 9router's proxy pool architecture,
 * featuring automatic persistence, dynamic runtime toggles, circuit breaker cooldowns,
 * and seamless fallback to direct connection upon relay failure.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ThemeColor } from '@earendil-works/pi-coding-agent';

export interface ProxyConfig {
  enabled: boolean;
  relayUrl: string;
  fallback: boolean;
  strictProxy: boolean;
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface ProxyStateSnapshot extends ProxyConfig {
  circuitState: CircuitState;
  isFallbackActive: boolean;
  consecutiveFailures: number;
}

export type ProxyStatusListener = (snapshot: ProxyStateSnapshot) => void;

const VERCEL_API = 'https://api.vercel.com';
const PROXY_CONFIG_FILENAME = 'opencode-zen-proxy.json';
const CIRCUIT_BREAKER_THRESHOLD = 2;
const CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;
const RELAY_CONNECT_TIMEOUT_MS = 7_000;

export const DEFAULT_PROXY_CONFIG: Readonly<ProxyConfig> = Object.freeze({
  enabled: false,
  relayUrl: '',
  fallback: true,
  strictProxy: false,
});

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

  const rawHeaders = {};
  for (const [k, v] of req.headers.entries()) rawHeaders[k] = v;
  delete rawHeaders["x-relay-target"];
  delete rawHeaders["x-relay-path"];
  delete rawHeaders["host"];

  const response = await fetch(targetUrl, {
    method: req.method,
    headers: rawHeaders,
    body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
    duplex: "half",
  });

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}
`;

function getProxyConfigFilePath(): string | undefined {
  try {
    const agentDir =
      process.env['PI_AGENT_DIR'] ||
      (process.env['HOME'] ? join(process.env['HOME'], '.pi', 'agent') : undefined);
    if (!agentDir) return undefined;
    return join(agentDir, PROXY_CONFIG_FILENAME);
  } catch {
    return undefined;
  }
}

export function loadPersistentProxyConfig(): Partial<ProxyConfig> {
  const filePath = getProxyConfigFilePath();
  if (!filePath) return {};
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<ProxyConfig>;
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed;
    }
  } catch {
    // Config file not present or unreadable
  }
  return {};
}

export function savePersistentProxyConfig(config: ProxyConfig): void {
  const filePath = getProxyConfigFilePath();
  if (!filePath) return;
  try {
    const dir = join(filePath, '..');
    mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
  } catch {
    // Ignore persistent write failures
  }
}

export function normalizeRelayUrl(url?: string | null): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '');
}

export function resolveInitialProxyConfig(): ProxyConfig {
  const persistent = loadPersistentProxyConfig();

  const envRelayUrl = normalizeRelayUrl(
    process.env['OPENCODE_VERCEL_PROXY_URL'] || process.env['VERCEL_PROXY_URL'],
  );
  const envEnabledRaw =
    process.env['OPENCODE_VERCEL_PROXY_ENABLED'] || process.env['VERCEL_PROXY_ENABLED'];
  const envStrictRaw =
    process.env['OPENCODE_VERCEL_PROXY_STRICT'] || process.env['VERCEL_PROXY_STRICT'];

  const relayUrl = persistent.relayUrl ? normalizeRelayUrl(persistent.relayUrl) : envRelayUrl;

  let enabled = DEFAULT_PROXY_CONFIG.enabled;
  if (persistent.enabled !== undefined) {
    enabled = Boolean(persistent.enabled);
  } else if (envEnabledRaw !== undefined) {
    enabled = envEnabledRaw.toLowerCase() === 'true' || envEnabledRaw === '1';
  } else if (relayUrl) {
    enabled = true;
  }

  let strictProxy = DEFAULT_PROXY_CONFIG.strictProxy;
  if (persistent.strictProxy !== undefined) {
    strictProxy = Boolean(persistent.strictProxy);
  } else if (envStrictRaw !== undefined) {
    strictProxy = envStrictRaw.toLowerCase() === 'true' || envStrictRaw === '1';
  }

  const fallback = persistent.fallback !== undefined ? Boolean(persistent.fallback) : !strictProxy;

  return {
    enabled,
    relayUrl,
    fallback,
    strictProxy,
  };
}

// Runtime Proxy State
let currentConfig: ProxyConfig = resolveInitialProxyConfig();
let consecutiveFailures = 0;
let lastFailureTimestamp = 0;
let circuitState: CircuitState = 'CLOSED';
let isFallbackActive = false;

const listeners = new Set<ProxyStatusListener>();

function emitStatusChange(): void {
  const snapshot = getProxyStateSnapshot();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch {
      // Ignore listener error
    }
  }
}

export function subscribeProxyStatus(listener: ProxyStatusListener): () => void {
  listeners.add(listener);
  listener(getProxyStateSnapshot());
  return () => {
    listeners.delete(listener);
  };
}

export function getProxyConfig(): Readonly<ProxyConfig> {
  return currentConfig;
}

export function getProxyStateSnapshot(): ProxyStateSnapshot {
  updateCircuitBreakerState();
  return {
    ...currentConfig,
    circuitState,
    isFallbackActive,
    consecutiveFailures,
  };
}

export function setProxyConfig(updates: Partial<ProxyConfig>, persist = true): ProxyStateSnapshot {
  currentConfig = {
    ...currentConfig,
    ...updates,
    relayUrl:
      updates.relayUrl !== undefined ? normalizeRelayUrl(updates.relayUrl) : currentConfig.relayUrl,
  };

  // If strictProxy changed, adjust fallback default accordingly
  if (updates.strictProxy !== undefined && updates.fallback === undefined) {
    currentConfig.fallback = !updates.strictProxy;
  }

  // Reset circuit breaker when toggling or updating URL
  consecutiveFailures = 0;
  circuitState = 'CLOSED';
  isFallbackActive = false;

  if (persist) {
    savePersistentProxyConfig(currentConfig);
  }

  emitStatusChange();
  return getProxyStateSnapshot();
}

export function toggleProxy(forceState?: boolean): ProxyStateSnapshot {
  const next = forceState !== undefined ? forceState : !currentConfig.enabled;
  return setProxyConfig({ enabled: next });
}

function updateCircuitBreakerState(): void {
  if (circuitState === 'OPEN') {
    const elapsed = Date.now() - lastFailureTimestamp;
    if (elapsed >= CIRCUIT_BREAKER_COOLDOWN_MS) {
      circuitState = 'HALF_OPEN';
    }
  }
}

function recordRelaySuccess(): void {
  consecutiveFailures = 0;
  circuitState = 'CLOSED';
  if (isFallbackActive) {
    isFallbackActive = false;
    emitStatusChange();
  }
}

function recordRelayFailure(): void {
  consecutiveFailures++;
  lastFailureTimestamp = Date.now();
  if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitState = 'OPEN';
  }
  if (!isFallbackActive && currentConfig.fallback && !currentConfig.strictProxy) {
    isFallbackActive = true;
  }
  emitStatusChange();
}

export function isOpencodeTarget(targetUrl: string | URL): boolean {
  try {
    const parsed = typeof targetUrl === 'string' ? new URL(targetUrl) : targetUrl;
    return parsed.hostname.includes('opencode.ai');
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

export function renderProxyStatusline(
  theme: { fg: (color: ThemeColor, text: string) => string },
  snapshot: ProxyStateSnapshot,
): string {
  if (!snapshot.enabled) {
    return theme.fg('dim', '🌐 Proxy: OFF');
  }

  if (!snapshot.relayUrl) {
    return theme.fg('warning', '⚠️ Proxy: No URL');
  }

  if (snapshot.isFallbackActive) {
    return theme.fg('warning', '⚠️ Proxy: Direct (Fallback)');
  }

  if (snapshot.circuitState === 'OPEN') {
    return theme.fg('warning', '⚠️ Proxy: Cooldown (Direct)');
  }

  return theme.fg('success', '⚡ Proxy: ON');
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

  const isRelayCandidate =
    currentConfig.enabled && Boolean(currentConfig.relayUrl) && isOpencodeTarget(targetUrl);

  if (!isRelayCandidate) {
    return dispatchFetch(input, init);
  }

  const allowFallback = currentConfig.fallback && !currentConfig.strictProxy;

  // Circuit breaker is open (cooling down): skip relay immediately
  if (circuitState === 'OPEN') {
    if (!allowFallback) {
      throw new Error(
        `[Proxy] Vercel relay is unreachable (circuit open, cooling down) and strictProxy is enabled`,
      );
    }
    isFallbackActive = true;
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

// ─── Automated Vercel Deployment ──────────────────────────────────────────

export interface DeployVercelRelayOptions {
  vercelToken: string;
  projectName?: string;
  onProgress?: (message: string) => void;
  maxPollMs?: number;
}

export interface DeployVercelRelayResult {
  deployUrl: string;
  deploymentId: string;
  projectName: string;
}

async function pollDeployment(
  deploymentId: string,
  token: string,
  maxMs = 120_000,
  onProgress?: (msg: string) => void,
): Promise<{ url: string }> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const res = await originalFetch(`${VERCEL_API}/v13/deployments/${deploymentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`Failed to check deployment status (HTTP ${res.status})`);
    }
    const data = (await res.json()) as { readyState?: string; url?: string };
    if (data.readyState === 'READY' && data.url) {
      return { url: data.url };
    }
    if (data.readyState === 'ERROR' || data.readyState === 'CANCELED') {
      throw new Error(`Vercel deployment failed with readyState: ${data.readyState}`);
    }
    onProgress?.(`Waiting for deployment readiness (state: ${data.readyState || 'BUILDING'})...`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('Vercel deployment timed out');
}

export async function deployVercelRelay(
  options: DeployVercelRelayOptions,
): Promise<DeployVercelRelayResult> {
  const token = options.vercelToken.trim();
  if (!token) {
    throw new Error('Vercel API token is required');
  }

  const projectName = options.projectName?.trim() || `relay-${Date.now().toString(36)}`;
  options.onProgress?.(`Initiating Vercel deployment for project "${projectName}"...`);

  const deployRes = await originalFetch(`${VERCEL_API}/v13/deployments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: projectName,
      files: [
        {
          file: 'api/relay.js',
          data: RELAY_FUNCTION_CODE,
        },
        {
          file: 'package.json',
          data: JSON.stringify({ name: projectName, version: '1.0.0' }),
        },
        {
          file: 'vercel.json',
          data: JSON.stringify({
            rewrites: [{ source: '/(.*)', destination: '/api/relay' }],
          }),
        },
      ],
      projectSettings: {
        framework: null,
      },
      target: 'production',
    }),
  });

  if (!deployRes.ok) {
    const errBody = (await deployRes.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(
      errBody.error?.message || `Failed to create Vercel deployment (HTTP ${deployRes.status})`,
    );
  }

  const deployment = (await deployRes.json()) as {
    id?: string;
    uid?: string;
    projectId?: string;
  };
  const deploymentId = deployment.id || deployment.uid;
  if (!deploymentId) {
    throw new Error('Vercel did not return a deployment ID');
  }

  options.onProgress?.('Configuring project settings (disabling SSO deployment protection)...');
  const projectId = deployment.projectId || projectName;
  await originalFetch(`${VERCEL_API}/v9/projects/${projectId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ssoProtection: null }),
  }).catch(() => {
    // Non-fatal if project patch returns warning
  });

  options.onProgress?.('Awaiting Vercel deployment ready state...');
  const ready = await pollDeployment(
    deploymentId,
    token,
    options.maxPollMs ?? 120_000,
    options.onProgress,
  );
  const deployUrl = `https://${ready.url}`;

  // Automatically update persistent configuration with the new relay URL
  setProxyConfig({ relayUrl: deployUrl, enabled: true });

  return {
    deployUrl,
    deploymentId,
    projectName,
  };
}
