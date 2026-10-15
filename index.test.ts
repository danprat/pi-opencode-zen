import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_BASE_URL,
  FREE_INFERENCE_BASE_URL,
  GATE_TOOLS,
  createOpencodeId,
  ensureOpencodeGateTools,
  getEndpointConfig,
  isFreeModel,
  normalizeModelId,
  opencodeHeaders,
  streamOpencodeZen,
} from './index.ts';

describe('OpenCode v2 Inference Base URL', () => {
  it('points default and free base URLs to /inference/v1', () => {
    expect(DEFAULT_BASE_URL).toBe('https://opencode.ai/inference/v1');
    expect(FREE_INFERENCE_BASE_URL).toBe('https://opencode.ai/inference/v1');
  });

  it('resolves endpoint configs with the inference v1 base URL', () => {
    const config = getEndpointConfig('big-pickle');
    expect(config.baseUrl).toBe('https://opencode.ai/inference/v1');
    expect(config.api).toBe('openai-completions');

    const museConfig = getEndpointConfig('muse-spark-1.3-contributor-free');
    expect(museConfig.baseUrl).toBe('https://opencode.ai/inference/v1');
    expect(museConfig.api).toBe('openai-responses');
  });
});

describe('Model Normalisation and Free Tier Detection', () => {
  it('normalises model ids by stripping prefixes', () => {
    expect(normalizeModelId('zen/big-pickle')).toBe('big-pickle');
    expect(normalizeModelId('opencode/cat-jam-free')).toBe('cat-jam-free');
    expect(normalizeModelId('oc/mimo')).toBe('mimo-v2.6-flash-free');
  });

  it('correctly identifies free tier models', () => {
    expect(isFreeModel('big-pickle')).toBe(true);
    expect(isFreeModel('cat-jam-free')).toBe(true);
    expect(isFreeModel('step-5-preview-free')).toBe(true);
    expect(isFreeModel('muse-spark-1.3-contributor-free')).toBe(true);
    expect(isFreeModel('gpt-5.4')).toBe(false);
    expect(isFreeModel('claude-sonnet-4-6')).toBe(false);
  });
});

describe('OpenCode v2 Fingerprint Headers and Session IDs', () => {
  it('generates canonical 30-char session IDs with pinned counter', () => {
    const id = createOpencodeId(true);
    expect(id).toHaveLength(26);

    const session = 'ses_' + id;
    expect(session).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
  });

  it('generates OpenCode v2 client headers for free inference', () => {
    const headers = opencodeHeaders('custom-session-123', true);
    expect(headers['User-Agent']).toBe('opencode/latest/2.0.29/cli');
    expect(headers['x-opencode-client']).toBe('cli');
    expect(headers['x-opencode-project']).toBe('global');
    expect(headers['Accept']).toBe('text/event-stream');

    const session = headers['x-opencode-session'];
    expect(session).toBeDefined();
    expect(headers['x-opencode-session-id']).toBe(session);
    expect(headers['x-session-affinity']).toBe(session);
    expect(headers['x-session-id']).toBe(session);
    expect(headers['x-opencode-request']).toBeUndefined();
  });

  it('generates OpenCode v1 desktop headers for paid requests', () => {
    const headers = opencodeHeaders('custom-session-123', false);
    expect(headers['User-Agent']).toBe(
      'opencode/1.18.31 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14',
    );
    expect(headers['x-opencode-client']).toBe('desktop');
    expect(headers['x-opencode-request']).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
  });
});

describe('OpenCode v2 Gate Tools', () => {
  it('defines exact read and shell schemas required by OpenCode v2', () => {
    const read = GATE_TOOLS.find((t) => t.name === 'read');
    expect(read).toBeDefined();
    expect(read?.description).toContain('Read the contents of a file or directory.');
    const readProps =
      read?.parameters && 'properties' in read.parameters ? read.parameters.properties : {};
    expect(readProps).toHaveProperty('path');
    expect(readProps).toHaveProperty('offset');
    expect(readProps).toHaveProperty('limit');

    const shell = GATE_TOOLS.find((t) => t.name === 'shell');
    expect(shell).toBeDefined();
    expect(shell?.description).toContain('Execute a shell command and return its output.');
    const shellProps =
      shell?.parameters && 'properties' in shell.parameters ? shell.parameters.properties : {};
    expect(shellProps).toHaveProperty('command');
    expect(shellProps).toHaveProperty('workdir');
    expect(shellProps).toHaveProperty('timeout');
    expect(shellProps).toHaveProperty('background');
  });

  it('ensures gate tools are injected into transcript context', () => {
    const context = {
      messages: [{ role: 'user' as const, content: 'hi' }],
    };
    const updated = ensureOpencodeGateTools(context);
    expect(updated.messages[0]?.role).toBe('system');
    const firstSystem = updated.messages[0] as { toolsAdded?: Array<{ name: string }> };
    expect(firstSystem.toolsAdded?.some((t) => t.name === 'read')).toBe(true);
    expect(firstSystem.toolsAdded?.some((t) => t.name === 'shell')).toBe(true);
  });
});

describe('Live Free Inference via /inference/v1', () => {
  it('successfully streams responses for free models rewrites legacy /zen/v1', async () => {
    const model = {
      id: 'big-pickle',
      name: 'Big Pickle',
      provider: 'opencode-zen',
      api: 'openai-completions' as const,
      baseUrl: 'https://opencode.ai/zen/v1', // deliberately pass legacy url
      reasoning: true,
      input: ['text' as const],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 128000,
    };

    const context = {
      messages: [{ role: 'user' as const, content: 'respond with pong' }],
    };

    const stream = streamOpencodeZen(model, context, { apiKey: 'public' });
    let text = '';
    let errorMessage: string | undefined;

    for await (const event of stream) {
      if (event.type === 'text_delta') {
        text += event.delta;
      } else if (event.type === 'error') {
        errorMessage = event.error.errorMessage;
      }
    }

    expect(errorMessage).toBeUndefined();
    expect(text.length).toBeGreaterThan(0);
  }, 15000);
});
