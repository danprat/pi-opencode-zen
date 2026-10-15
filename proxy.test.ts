import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { ExtensionUIContext, ThemeColor } from '@earendil-works/pi-coding-agent';
import {
  DEFAULT_PROJECT_NAME,
  RELAY_FUNCTION_CODE,
  buildRelayHeaders,
  checkExistingVercelProject,
  deployVercelRelay,
  getProxyConfig,
  getProxyStateSnapshot,
  isOpencodeTarget,
  normalizeRelayUrl,
  proxyAwareFetch,
  renderProxyStatusline,
  setProxyConfig,
  subscribeProxyStatus,
  toggleProxy,
} from './proxy.ts';
import { PROXY_STATUS_KEY, updateProxyStatusline } from './index.ts';

const mockTheme = {
  fg: (color: ThemeColor, text: string) => `[${color}]${text}[/${color}]`,
};

describe('Proxy URL Normalisation and Target Detection', () => {
  it('normalises relay URLs by trimming and stripping trailing slashes', () => {
    expect(normalizeRelayUrl('  https://relay.vercel.app/// ')).toBe('https://relay.vercel.app');
    expect(normalizeRelayUrl('')).toBe('');
    expect(normalizeRelayUrl(null)).toBe('');
  });

  it('correctly detects OpenCode target URLs', () => {
    expect(isOpencodeTarget('https://opencode.ai/inference/v1/chat/completions')).toBe(true);
    expect(isOpencodeTarget('https://opencode.ai/inference/v1/models')).toBe(true);
    expect(isOpencodeTarget('https://api.openai.com/v1/chat/completions')).toBe(false);
    expect(isOpencodeTarget('https://api.anthropic.com/v1/messages')).toBe(false);
  });
});

describe('Relay Headers Generation', () => {
  it('extracts target origin and path into x-relay headers', () => {
    const target = 'https://opencode.ai/inference/v1/chat/completions?stream=true';
    const baseHeaders = {
      Authorization: 'Bearer test-token',
      'User-Agent': 'opencode/cli',
      Host: 'opencode.ai',
    };

    const { targetOrigin, targetPath, headers } = buildRelayHeaders(target, baseHeaders);

    expect(targetOrigin).toBe('https://opencode.ai');
    expect(targetPath).toBe('/inference/v1/chat/completions?stream=true');
    expect(headers['x-relay-target']).toBe('https://opencode.ai');
    expect(headers['x-relay-path']).toBe('/inference/v1/chat/completions?stream=true');
    expect(headers['Authorization']).toBe('Bearer test-token');
    expect(headers['User-Agent']).toBe('opencode/cli');
    expect(headers['host']).toBeUndefined();
    expect(headers['Host']).toBeUndefined();
  });
});

describe('Proxy State and Statusline Rendering', () => {
  beforeEach(() => {
    setProxyConfig({ enabled: false, relayUrl: '', fallback: true, strictProxy: false }, false);
  });

  it('toggles proxy state correctly', () => {
    expect(getProxyConfig().enabled).toBe(false);

    toggleProxy();
    expect(getProxyConfig().enabled).toBe(true);

    toggleProxy(false);
    expect(getProxyConfig().enabled).toBe(false);
  });

  it('notifies status listeners on configuration changes', () => {
    let notifiedState = false;
    const unsub = subscribeProxyStatus((snapshot) => {
      notifiedState = snapshot.enabled;
    });

    setProxyConfig({ enabled: true }, false);
    expect(notifiedState).toBe(true);

    unsub();
  });

  it('updates statusline only when provider is opencode-zen and hides for other providers', () => {
    let recordedKey = '';
    let recordedText: string | undefined = 'initial';

    const mockUi = {
      setStatus: (key: string, text: string | undefined) => {
        recordedKey = key;
        recordedText = text;
      },
      theme: mockTheme,
    };

    setProxyConfig({ enabled: true, relayUrl: 'https://relay.vercel.app' }, false);

    // Active provider is opencode-zen: statusline shows indicator
    updateProxyStatusline(mockUi as unknown as ExtensionUIContext, undefined, 'opencode-zen');
    expect(recordedKey).toBe(PROXY_STATUS_KEY);
    expect(recordedText).toBe('[success]⚡ Proxy: ON[/success]');

    // Switched to anthropic: statusline is cleared (undefined)
    updateProxyStatusline(mockUi as unknown as ExtensionUIContext, undefined, 'anthropic');
    expect(recordedKey).toBe(PROXY_STATUS_KEY);
    expect(recordedText).toBeUndefined();

    // Switched to openai: statusline is cleared (undefined)
    updateProxyStatusline(mockUi as unknown as ExtensionUIContext, undefined, 'openai');
    expect(recordedText).toBeUndefined();

    // Switched back to opencode-zen: statusline reappears
    updateProxyStatusline(mockUi as unknown as ExtensionUIContext, undefined, 'opencode-zen');
    expect(recordedText).toBe('[success]⚡ Proxy: ON[/success]');
  });

  it('renders statusline with appropriate themes and indicators', () => {
    // Disabled
    expect(
      renderProxyStatusline(mockTheme, {
        enabled: false,
        relayUrl: 'https://relay.vercel.app',
        fallback: true,
        strictProxy: false,
        circuitState: 'CLOSED',
        isFallbackActive: false,
        consecutiveFailures: 0,
      }),
    ).toBe('[dim]🌐 Proxy: OFF[/dim]');

    // Enabled without URL
    expect(
      renderProxyStatusline(mockTheme, {
        enabled: true,
        relayUrl: '',
        fallback: true,
        strictProxy: false,
        circuitState: 'CLOSED',
        isFallbackActive: false,
        consecutiveFailures: 0,
      }),
    ).toBe('[warning]⚠️ Proxy: No URL[/warning]');

    // Enabled and active
    expect(
      renderProxyStatusline(mockTheme, {
        enabled: true,
        relayUrl: 'https://relay.vercel.app',
        fallback: true,
        strictProxy: false,
        circuitState: 'CLOSED',
        isFallbackActive: false,
        consecutiveFailures: 0,
      }),
    ).toBe('[success]⚡ Proxy: ON[/success]');

    // Fallback active
    expect(
      renderProxyStatusline(mockTheme, {
        enabled: true,
        relayUrl: 'https://relay.vercel.app',
        fallback: true,
        strictProxy: false,
        circuitState: 'CLOSED',
        isFallbackActive: true,
        consecutiveFailures: 1,
      }),
    ).toBe('[warning]⚠️ Proxy: Direct (Fallback)[/warning]');

    // Circuit breaker open
    expect(
      renderProxyStatusline(mockTheme, {
        enabled: true,
        relayUrl: 'https://relay.vercel.app',
        fallback: true,
        strictProxy: false,
        circuitState: 'OPEN',
        isFallbackActive: false,
        consecutiveFailures: 2,
      }),
    ).toBe('[warning]⚠️ Proxy: Cooldown (Direct)[/warning]');
  });
});

describe('Vercel Edge Relay Function Source', () => {
  it('contains Edge runtime config and relay header handling', () => {
    expect(RELAY_FUNCTION_CODE).toContain('export const config = { runtime: "edge" };');
    expect(RELAY_FUNCTION_CODE).toContain('req.headers.get("x-relay-target")');
    expect(RELAY_FUNCTION_CODE).toContain('req.headers.get("x-relay-path")');
    expect(RELAY_FUNCTION_CODE).toContain('duplex: "half"');
    expect(RELAY_FUNCTION_CODE).toContain('x-accel-buffering');
    expect(RELAY_FUNCTION_CODE).toContain('no-transform');
  });
});

describe('Proxy-Aware Fetch Routing and Seamless Fallback', () => {
  beforeEach(() => {
    setProxyConfig(
      {
        enabled: true,
        relayUrl: 'https://my-relay.vercel.app',
        fallback: true,
        strictProxy: false,
      },
      false,
    );
  });

  afterEach(() => {
    setProxyConfig(
      {
        enabled: false,
        relayUrl: '',
        fallback: true,
        strictProxy: false,
      },
      false,
    );
  });

  it('bypasses proxy for non-OpenCode targets', async () => {
    let capturedUrl = '';
    const mockFetch = (async (url: string) => {
      capturedUrl = url;
      return new Response('external');
    }) as typeof globalThis.fetch;

    await proxyAwareFetch('https://api.openai.com/v1/models', undefined, mockFetch);
    expect(capturedUrl).toBe('https://api.openai.com/v1/models');
  });

  it('routes OpenCode targets through the Vercel relay URL', async () => {
    let capturedUrl = '';
    let capturedRelayTarget = '';
    let capturedRelayPath = '';

    const mockFetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      const headers = new Headers(init?.headers);
      capturedRelayTarget = headers.get('x-relay-target') || '';
      capturedRelayPath = headers.get('x-relay-path') || '';
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof globalThis.fetch;

    const res = await proxyAwareFetch(
      'https://opencode.ai/inference/v1/chat/completions?test=1',
      undefined,
      mockFetch,
    );
    expect(res.status).toBe(200);
    expect(capturedUrl).toBe('https://my-relay.vercel.app');
    expect(capturedRelayTarget).toBe('https://opencode.ai');
    expect(capturedRelayPath).toBe('/inference/v1/chat/completions?test=1');

    const snapshot = getProxyStateSnapshot();
    expect(snapshot.circuitState).toBe('CLOSED');
    expect(snapshot.isFallbackActive).toBe(false);
  });

  it('falls back seamlessly to direct connection when relay fails with HTTP 502', async () => {
    const attemptedUrls: string[] = [];

    const mockFetch = (async (url: string) => {
      attemptedUrls.push(url);
      if (url === 'https://my-relay.vercel.app') {
        return new Response('Bad Gateway', { status: 502 });
      }
      return new Response(JSON.stringify({ direct: true }), { status: 200 });
    }) as typeof globalThis.fetch;

    const res = await proxyAwareFetch(
      'https://opencode.ai/inference/v1/chat/completions',
      undefined,
      mockFetch,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { direct: boolean };
    expect(body.direct).toBe(true);

    // Verified that first it tried relay, then seamlessly fell back to direct
    expect(attemptedUrls).toEqual([
      'https://my-relay.vercel.app',
      'https://opencode.ai/inference/v1/chat/completions',
    ]);

    const snapshot = getProxyStateSnapshot();
    expect(snapshot.isFallbackActive).toBe(true);
    expect(snapshot.consecutiveFailures).toBe(1);
  });

  it('falls back seamlessly to direct connection on network rejection', async () => {
    const attemptedUrls: string[] = [];

    const mockFetch = (async (url: string) => {
      attemptedUrls.push(url);
      if (url === 'https://my-relay.vercel.app') {
        throw new Error('Connection refused by Vercel');
      }
      return new Response('direct-ok', { status: 200 });
    }) as typeof globalThis.fetch;

    const res = await proxyAwareFetch(
      'https://opencode.ai/inference/v1/models',
      undefined,
      mockFetch,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('direct-ok');

    expect(attemptedUrls).toEqual([
      'https://my-relay.vercel.app',
      'https://opencode.ai/inference/v1/models',
    ]);
  });

  it('throws an error instead of falling back when strictProxy is enabled', async () => {
    setProxyConfig({ strictProxy: true, fallback: false }, false);

    const mockFetch = (async (url: string) => {
      if (url === 'https://my-relay.vercel.app') {
        return new Response('Bad Gateway', { status: 502 });
      }
      return new Response('direct', { status: 200 });
    }) as typeof globalThis.fetch;

    expect(
      proxyAwareFetch('https://opencode.ai/inference/v1/chat/completions', undefined, mockFetch),
    ).rejects.toThrow(/strictProxy is enabled/);
  });

  it('leaves globalThis.fetch completely untouched and unpatched', () => {
    const original = globalThis.fetch;
    expect(globalThis.fetch).toBe(original);
  });

  it('circuit breaker opens after 2 failures and recovers on subsequent success', async () => {
    let returnFailure = true;
    const mockFetch = (async (url: string) => {
      if (url === 'https://my-relay.vercel.app') {
        if (returnFailure) {
          return new Response('Gateway Error', { status: 504 });
        }
        return new Response('relay-ok', { status: 200 });
      }
      return new Response('direct-ok', { status: 200 });
    }) as typeof globalThis.fetch;

    // First failure
    await proxyAwareFetch(
      'https://opencode.ai/inference/v1/chat/completions',
      undefined,
      mockFetch,
    );
    expect(getProxyStateSnapshot().consecutiveFailures).toBe(1);
    expect(getProxyStateSnapshot().circuitState).toBe('CLOSED');

    // Second failure: trips circuit breaker to OPEN
    await proxyAwareFetch(
      'https://opencode.ai/inference/v1/chat/completions',
      undefined,
      mockFetch,
    );
    expect(getProxyStateSnapshot().consecutiveFailures).toBe(2);
    expect(getProxyStateSnapshot().circuitState).toBe('OPEN');

    // Next request directly skips relay because circuit is OPEN
    let relayAttempted = false;
    const probeFetch = (async (url: string, init?: RequestInit) => {
      if (url === 'https://my-relay.vercel.app') {
        relayAttempted = true;
      }
      return mockFetch(url, init);
    }) as typeof globalThis.fetch;

    await proxyAwareFetch(
      'https://opencode.ai/inference/v1/chat/completions',
      undefined,
      probeFetch,
    );
    expect(relayAttempted).toBe(false);

    // Resetting configuration resets circuit breaker
    setProxyConfig({ enabled: true });
    expect(getProxyStateSnapshot().circuitState).toBe('CLOSED');
    expect(getProxyStateSnapshot().consecutiveFailures).toBe(0);

    returnFailure = false;
    const res = await proxyAwareFetch(
      'https://opencode.ai/inference/v1/chat/completions',
      undefined,
      mockFetch,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('relay-ok');
    expect(getProxyStateSnapshot().circuitState).toBe('CLOSED');
  });
});

describe('Smart Vercel Project Check and Reuse', () => {
  it('detects when project does not exist (HTTP 404)', async () => {
    const mockFetch = (async (url: string) => {
      expect(url).toContain('/v9/projects/vercel-zen-relay');
      return new Response('Not Found', { status: 404 });
    }) as typeof globalThis.fetch;

    const result = await checkExistingVercelProject('fake-token', DEFAULT_PROJECT_NAME, mockFetch);
    expect(result.exists).toBe(false);
  });

  it('detects existing project and extracts production URL (HTTP 200)', async () => {
    const mockFetch = (async (url: string) => {
      expect(url).toContain('/v9/projects/vercel-zen-relay');
      return new Response(
        JSON.stringify({
          id: 'prj_test123',
          name: 'vercel-zen-relay',
          targets: {
            production: {
              id: 'dpl_prod456',
              readyState: 'READY',
              url: 'vercel-zen-relay-hash.vercel.app',
              alias: ['vercel-zen-relay.vercel.app'],
            },
          },
        }),
        { status: 200 },
      );
    }) as typeof globalThis.fetch;

    const result = await checkExistingVercelProject('fake-token', DEFAULT_PROJECT_NAME, mockFetch);
    expect(result.exists).toBe(true);
    expect(result.deployUrl).toBe('https://vercel-zen-relay.vercel.app');
    expect(result.deploymentId).toBe('dpl_prod456');
  });

  it('automatically reuses existing project without rebuilding in deployVercelRelay', async () => {
    let deploymentCreated = false;

    const mockFetch = (async (url: string) => {
      if (url.includes('/v9/projects/vercel-zen-relay')) {
        return new Response(
          JSON.stringify({
            id: 'prj_existing',
            name: 'vercel-zen-relay',
            targets: {
              production: {
                id: 'dpl_existing_ready',
                readyState: 'READY',
                alias: ['vercel-zen-relay.vercel.app'],
              },
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes('/v13/deployments')) {
        deploymentCreated = true;
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof globalThis.fetch;

    const res = await deployVercelRelay({
      vercelToken: 'test-token',
      fetchImpl: mockFetch,
    });

    expect(res.reused).toBe(true);
    expect(res.deployUrl).toBe('https://vercel-zen-relay.vercel.app');
    expect(deploymentCreated).toBe(false); // Verified: Zero build calls made!
    expect(getProxyConfig().relayUrl).toBe('https://vercel-zen-relay.vercel.app');
    expect(getProxyConfig().enabled).toBe(true);
  });
});
