import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import test from 'node:test';
import type { Api, Model, TranscriptContext } from '@earendil-works/pi-ai';
import {
  baseUrlFor,
  buildModels,
  endpointFor,
  getConfiguredApiKey,
  isFreeModel,
  isPublicMode,
  opencodeFetch,
  opencodeHeaders,
  projectId,
  resolveApiKey,
  sessionId,
  streamOpencodeZen,
  thinkingLevelMapFor,
} from './index.ts';

const OPENAI_BASE = 'https://opencode.ai/inference/openai/v1';
const ANTHROPIC_BASE = 'https://opencode.ai/inference/anthropic/v1';
const GOOGLE_BASE = 'https://opencode.ai/inference/google/v1beta';

type Catalog = NonNullable<Parameters<typeof buildModels>[0]>;

const catalog: Catalog = {
  api: OPENAI_BASE,
  npm: '@ai-sdk/openai-compatible',
  models: {
    'claude-opus': {
      name: 'Claude Opus',
      status: 'active',
      reasoning: true,
      reasoning_options: [{ type: 'toggle' }, { type: 'effort', values: ['low', 'high', 'max'] }],
      modalities: { input: ['text', 'image'], output: ['text'] },
      limit: { context: 200000, output: 32000 },
      provider: { npm: '@ai-sdk/anthropic', api: ANTHROPIC_BASE },
      cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
    },
    'mistral-large': {
      name: 'Mistral Large',
      reasoning: false,
      modalities: { input: ['text'], output: ['text'] },
      provider: { npm: '@ai-sdk/mistral', api: OPENAI_BASE },
      cost: { input: 2, output: 6 },
    },
    'gpt-flagship': {
      name: 'GPT Flagship',
      modalities: { input: ['text'], output: ['text'] },
      provider: { npm: '@ai-sdk/openai', api: OPENAI_BASE },
      cost: { input: 1, output: 2 },
    },
    'gemini-flash': {
      name: 'Gemini Flash',
      modalities: { input: ['text'], output: ['text'] },
      provider: { npm: '@ai-sdk/google', api: GOOGLE_BASE },
      cost: { input: 1, output: 2 },
    },
    'custom-chat': {
      name: 'Custom Chat',
      modalities: { input: ['text'], output: ['text'] },
      provider: { api: OPENAI_BASE },
      cost: { input: 1, output: 2 },
    },
    'retired-model': {
      name: 'Retired',
      status: 'deprecated',
      modalities: { input: ['text'], output: ['text'] },
      cost: { input: 1, output: 2 },
    },
    'speech-only': {
      name: 'Speech Only',
      modalities: { input: ['audio'], output: ['text'] },
      cost: { input: 1, output: 2 },
    },
    'free-model': {
      name: 'Free Model',
      reasoning: true,
      reasoning_options: [{ type: 'effort', values: ['none', 'low', 'high'] }],
      modalities: { input: ['text'], output: ['text'] },
      cost: { input: 0, output: 0 },
    },
    'tiered-model': {
      name: 'Tiered Model',
      modalities: { input: ['text'], output: ['text'] },
      cost: {
        input: 0,
        output: 0,
        tiers: [{ input: 2, output: 4, tier: { type: 'context', size: 128000 } }],
      },
    },
  },
};

const fallback = { npm: '@ai-sdk/openai-compatible', api: OPENAI_BASE };

test('routes npm packages to the matching protocol', () => {
  assert.deepEqual(endpointFor(catalog.models!['claude-opus']!, fallback), {
    api: 'anthropic-messages',
    baseUrl: 'https://opencode.ai/inference/anthropic',
  });
  assert.deepEqual(endpointFor(catalog.models!['mistral-large']!, fallback), {
    api: 'mistral-conversations',
    baseUrl: 'https://opencode.ai/inference/openai',
  });
  assert.deepEqual(endpointFor(catalog.models!['gpt-flagship']!, fallback), {
    api: 'openai-responses',
    baseUrl: OPENAI_BASE,
  });
  assert.deepEqual(endpointFor(catalog.models!['gemini-flash']!, fallback), {
    api: 'google-generative-ai',
    baseUrl: GOOGLE_BASE,
  });
  assert.deepEqual(endpointFor(catalog.models!['custom-chat']!, fallback), {
    api: 'openai-completions',
    baseUrl: OPENAI_BASE,
  });
});

test('leaves the version segment out of SDK base URLs that append it', () => {
  assert.equal(
    baseUrlFor('anthropic-messages', ANTHROPIC_BASE),
    'https://opencode.ai/inference/anthropic',
  );
  assert.equal(
    baseUrlFor('mistral-conversations', OPENAI_BASE),
    'https://opencode.ai/inference/openai',
  );
  assert.equal(baseUrlFor('openai-completions', OPENAI_BASE), OPENAI_BASE);
  assert.equal(baseUrlFor('openai-responses', OPENAI_BASE), OPENAI_BASE);
  assert.equal(baseUrlFor('google-generative-ai', GOOGLE_BASE), GOOGLE_BASE);
});

test('drops deprecated and non-text models', () => {
  const ids = buildModels(catalog, false).map((model) => model.id);
  assert.ok(ids.includes('claude-opus'));
  assert.ok(!ids.includes('retired-model'));
  assert.ok(!ids.includes('speech-only'));
});

test('public mode keeps only models with no paid tier', () => {
  const ids = buildModels(catalog, true).map((model) => model.id);
  assert.deepEqual(ids.sort(), ['free-model']);
  assert.equal(isFreeModel(catalog.models!['free-model']), true);
  assert.equal(isFreeModel(catalog.models!['tiered-model']), false);
  assert.equal(isFreeModel(catalog.models!['claude-opus']), false);
});

test('maps catalog cost tiers and limits onto the model', () => {
  const model = buildModels(catalog, false).find((entry) => entry.id === 'tiered-model');
  assert.ok(model);
  assert.equal(model.cost.input, 0);
  assert.deepEqual(model.cost.tiers, [
    { input: 2, output: 4, cacheRead: 0, cacheWrite: 0, inputTokensAbove: 128000 },
  ]);
});

test('maps effort reasoning options onto pi thinking levels', () => {
  assert.deepEqual(thinkingLevelMapFor(catalog.models!['claude-opus']!), {
    minimal: null,
    low: 'low',
    medium: null,
    high: 'high',
    xhigh: null,
    max: 'max',
  });
  assert.deepEqual(thinkingLevelMapFor(catalog.models!['free-model']!), {
    off: 'none',
    minimal: null,
    low: 'low',
    medium: null,
    high: 'high',
    xhigh: null,
    max: null,
  });
  assert.equal(thinkingLevelMapFor(catalog.models!['custom-chat']!), undefined);
});

test('prefers a real key over the public anonymous key', () => {
  assert.equal(resolveApiKey('sk-real', {}), 'sk-real');
  assert.equal(resolveApiKey('public', { OPENCODE_API_KEY: 'sk-env' }), 'sk-env');
  assert.equal(resolveApiKey(undefined, { OPENCODE_API_KEY: 'sk-env' }), 'sk-env');
  assert.equal(resolveApiKey('public', {}), 'public');
  assert.equal(resolveApiKey(undefined, {}), 'public');
});

test('treats a missing or public key as anonymous mode', () => {
  assert.equal(isPublicMode(undefined), true);
  assert.equal(isPublicMode('public'), true);
  assert.equal(isPublicMode('sk-real'), false);
});

test('reads the configured key from the environment first', () => {
  assert.equal(getConfiguredApiKey({ OPENCODE_API_KEY: ' sk-env ' }), 'sk-env');
  assert.equal(getConfiguredApiKey({}, '/nonexistent-pi-opencode-zen-test/auth.json'), undefined);
});

test('sends CLI-style user agent and a stable project header', () => {
  const headers = opencodeHeaders('/some/project');
  assert.equal(headers['User-Agent'], 'opencode/latest/2.0.30/cli');
  assert.equal(headers['x-opencode-project'], projectId('/some/project'));
  assert.notEqual(projectId('/a'), projectId('/b'));
  assert.match(headers['x-opencode-session']!, /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
});

test('builds descending OpenCode session identifiers', () => {
  const timestamp = 1_700_000_000_000;
  const id = sessionId(timestamp, new Uint8Array(14));
  assert.match(id, /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);

  const later = sessionId(timestamp + 1, new Uint8Array(14));
  assert.ok(later.slice(4, 16) < id.slice(4, 16), 'newer identifiers sort lower');
  const other = sessionId(timestamp, new Uint8Array(14).fill(1));
  assert.notEqual(other, id, 'random suffix varies');
});

function clientHelloCiphers(hello: Buffer): number[] {
  const sessionIdEnd = 5 + 4 + 2 + 32 + 1 + hello[43]!;
  const length = hello.readUInt16BE(sessionIdEnd);
  return Array.from({ length: length / 2 }, (_, index) =>
    hello.readUInt16BE(sessionIdEnd + 2 + index * 2),
  );
}

test('offers the TLS ciphers the OpenCode CLI offers', async () => {
  const hello = new Promise<Buffer>((resolve) => {
    const server = createServer((socket) => {
      socket.once('data', (data: Buffer) => {
        resolve(data);
        socket.destroy();
        server.close();
      });
    }).listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      opencodeFetch(`https://127.0.0.1:${port}/`).catch(() => {});
    });
  });
  assert.deepEqual(
    clientHelloCiphers(await hello),
    [
      0x1301, 0x1302, 0x1303, 0xc02b, 0xc02f, 0xc02c, 0xc030, 0xcca9, 0xcca8, 0xc009, 0xc013,
      0xc00a, 0xc014, 0x009c, 0x009d, 0x002f, 0x0035,
    ],
  );
});

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function capturingFetch(captured: CapturedRequest[]) {
  return async (input: unknown, init?: { headers?: HeadersInit; body?: unknown }) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : ((input as { url: string }).url ?? '');
    captured.push({
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === 'string' ? init.body : '',
    });
    return new Response('', { status: 401, headers: { 'content-type': 'text/plain' } });
  };
}

function chatModel(id: string): Model<Api> {
  return {
    id,
    name: id,
    api: 'openai-completions',
    provider: 'opencode-zen',
    baseUrl: OPENAI_BASE,
    input: ['text'],
    cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
    contextWindow: 100000,
    maxTokens: 1000,
  } as Model<Api>;
}

async function capture(
  modelId: string,
  options: Record<string, unknown> = {},
): Promise<CapturedRequest> {
  buildModels(catalog, false);
  const captured: CapturedRequest[] = [];
  const stream = streamOpencodeZen(
    chatModel(modelId),
    { messages: [] } as unknown as TranscriptContext,
    {
      apiKey: 'public',
      sessionId: 'ses_test',
      fetch: capturingFetch(captured) as never,
      ...options,
    },
  );
  try {
    for await (const _event of stream) void _event;
  } catch {
    // The stub response is intentionally an error; only the captured request matters.
  }
  assert.equal(captured.length, 1);
  return captured[0]!;
}

test('anthropic models keep a single version segment in the request path', async () => {
  const request = await capture('claude-opus');
  assert.equal(new URL(request.url).pathname, '/inference/anthropic/v1/messages');
  assert.equal(request.headers['x-api-key'], 'public');
  assert.equal(request.headers['user-agent'], 'opencode/latest/2.0.30/cli');
  assert.ok(request.headers['x-opencode-project']);
});

test('openai-compatible models target the gateway chat completions path', async () => {
  const request = await capture('custom-chat');
  assert.equal(new URL(request.url).pathname, '/inference/openai/v1/chat/completions');
  assert.equal(request.headers['authorization'], 'Bearer public');
});

test('mistral models reuse the gateway chat completions path', async () => {
  const request = await capture('mistral-large');
  assert.equal(new URL(request.url).pathname, '/inference/openai/v1/chat/completions');
});

test('sends an OpenCode session id, overriding pi attribution', async () => {
  const request = await capture('custom-chat', {
    headers: { 'x-opencode-session': '01a1440f-3a9d-73d0-b3e5-83a2defdc13f' },
  });
  assert.match(request.headers['x-opencode-session']!, /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
});

test('adds an OpenCode environment block to the system prompt', async () => {
  const request = await capture('custom-chat');
  const env = `<env>\n  Working directory: ${process.cwd()}\n</env>`;
  assert.ok(request.body.includes(JSON.stringify(env).slice(1, -1)));
});
