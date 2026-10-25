import {
  type Api,
  type AssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
  type SystemMessage,
  type ThinkingLevelMap,
  type TranscriptContext,
} from '@earendil-works/pi-ai';
import {
  anthropicMessagesApi,
  googleGenerativeAIApi,
  mistralConversationsApi,
  openAICompletionsApi,
  openAIResponsesApi,
} from '@earendil-works/pi-ai/compat';
import {
  getAgentDir,
  type ExtensionAPI,
  type ProviderModelConfig,
} from '@earendil-works/pi-coding-agent';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Agent, fetch as undiciFetch } from 'undici';

type Backend =
  | 'anthropic-messages'
  | 'google-generative-ai'
  | 'mistral-conversations'
  | 'openai-completions'
  | 'openai-responses';

interface EndpointConfig {
  api: Backend;
  baseUrl: string;
}

interface CostTier {
  input?: number | null;
  output?: number | null;
  cache_read?: number | null;
  cache_write?: number | null;
  tier?: { type?: string | null; size?: number | null } | null;
}

interface ReasoningOption {
  type?: string | null;
  values?: string[] | null;
}

interface ModelsDevModelInfo {
  name?: string | null;
  status?: string | null;
  reasoning?: boolean | null;
  reasoning_options?: ReasoningOption[] | null;
  modalities?: { input?: string[] | null; output?: string[] | null } | null;
  limit?: { context?: number | null; output?: number | null } | null;
  provider?: { npm?: string | null; api?: string | null } | null;
  cost?: {
    input?: number | null;
    output?: number | null;
    cache_read?: number | null;
    cache_write?: number | null;
    tiers?: CostTier[] | null;
  } | null;
}

interface ModelsDevProvider {
  api?: string | null;
  npm?: string | null;
  models?: Record<string, ModelsDevModelInfo> | null;
}

const API_KEY_ENV = 'OPENCODE_API_KEY';
const PUBLIC_API_KEY = 'public';
const DEFAULT_NPM = '@ai-sdk/openai-compatible';
const OPENCODE_BASE_URL = 'https://opencode.ai/inference/openai/v1';
const MODELS_URL = 'https://models.opencode.ai/api.json';
const MODELS_FALLBACK_URL = 'https://models.dev/api.json';
const OPENCODE_VERSION = '2.0.30';
const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
const IDENTIFIER_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const OPENCODE_CIPHERS = [
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-ECDSA-AES128-SHA',
  'ECDHE-RSA-AES128-SHA',
  'ECDHE-ECDSA-AES256-SHA',
  'ECDHE-RSA-AES256-SHA',
  'AES128-GCM-SHA256',
  'AES256-GCM-SHA384',
  'AES128-SHA',
  'AES256-SHA',
].join(':');

const backendsByNpm: Record<string, Backend> = {
  '@ai-sdk/anthropic': 'anthropic-messages',
  '@ai-sdk/google': 'google-generative-ai',
  '@ai-sdk/mistral': 'mistral-conversations',
  '@ai-sdk/openai': 'openai-responses',
};

const endpoints: Record<string, EndpointConfig> = {};

export function baseUrlFor(backend: Backend, base: string): string {
  return backend === 'anthropic-messages' || backend === 'mistral-conversations'
    ? base.replace(/\/v1$/, '')
    : base;
}

export function endpointFor(
  info: ModelsDevModelInfo,
  fallback: { npm: string; api: string } = { npm: DEFAULT_NPM, api: OPENCODE_BASE_URL },
): EndpointConfig {
  const api = backendsByNpm[info.provider?.npm ?? fallback.npm] ?? 'openai-completions';
  const base = info.provider?.api ?? fallback.api;
  return { api, baseUrl: baseUrlFor(api, base) };
}

export function getConfiguredApiKey(
  env: NodeJS.ProcessEnv = process.env,
  authPath = join(getAgentDir(), 'auth.json'),
): string | undefined {
  const fromEnv = env[API_KEY_ENV]?.trim();
  if (fromEnv) return fromEnv;

  try {
    const auth = JSON.parse(readFileSync(authPath, 'utf8')) as Record<string, { key?: string }>;
    return auth['opencode-zen']?.key?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function resolveApiKey(
  apiKey: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (apiKey && apiKey !== PUBLIC_API_KEY) return apiKey;
  return env[API_KEY_ENV]?.trim() || PUBLIC_API_KEY;
}

export function isPublicMode(apiKey?: string): boolean {
  return !apiKey || apiKey === PUBLIC_API_KEY;
}

export function isFreeModel(info: ModelsDevModelInfo | undefined): boolean {
  const cost = info?.cost;
  if (!cost) return false;
  const inputs = [cost.input ?? 0, ...(cost.tiers ?? []).map((tier) => tier.input ?? 0)];
  return inputs.every((input) => input <= 0);
}

function supportsText(info: ModelsDevModelInfo): boolean {
  const hasText = (modalities: string[] | null | undefined) =>
    !modalities || modalities.length === 0 || modalities.some((item) => item.startsWith('text'));
  return hasText(info.modalities?.input) && hasText(info.modalities?.output);
}

export function thinkingLevelMapFor(info: ModelsDevModelInfo): ThinkingLevelMap | undefined {
  const options = info.reasoning_options ?? [];
  const effort = options.find((option) => option.type === 'effort' && option.values?.length);
  if (!effort?.values) return undefined;

  const values = new Set(effort.values);
  const map: ThinkingLevelMap = {};
  for (const level of THINKING_LEVELS) map[level] = values.has(level) ? level : null;
  if (values.has('none')) map.off = 'none';
  else if (!options.some((option) => option.type === 'toggle')) map.off = null;
  return map;
}

async function fetchModelsDevProvider(): Promise<ModelsDevProvider | undefined> {
  for (const url of [MODELS_URL, MODELS_FALLBACK_URL]) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const json = (await response.json()) as { opencode?: ModelsDevProvider };
      if (json.opencode?.models) return json.opencode;
    } catch {
      continue;
    }
  }
  return undefined;
}

export function buildModels(
  provider: ModelsDevProvider | undefined,
  publicMode = false,
): ProviderModelConfig[] {
  const models = provider?.models;
  if (!models) return [];

  const fallback = {
    npm: provider?.npm ?? DEFAULT_NPM,
    api: provider?.api ?? OPENCODE_BASE_URL,
  };

  return Object.entries(models)
    .filter(([, info]) => info.status !== 'deprecated' && supportsText(info))
    .filter(([, info]) => !publicMode || isFreeModel(info))
    .map(([id, info]) => {
      endpoints[id] = endpointFor(info, fallback);

      const input = (info.modalities?.input ?? ['text']).filter(
        (value): value is 'text' | 'image' => value === 'text' || value === 'image',
      );
      const tiers = (info.cost?.tiers ?? []).map((tier) => ({
        input: tier.input ?? 0,
        output: tier.output ?? 0,
        cacheRead: tier.cache_read ?? 0,
        cacheWrite: tier.cache_write ?? 0,
        inputTokensAbove: tier.tier?.size ?? 0,
      }));

      const thinkingLevelMap = thinkingLevelMapFor(info);
      const model: ProviderModelConfig = {
        id,
        name: info.name ?? id,
        reasoning: info.reasoning ?? false,
        input,
        cost: {
          input: info.cost?.input ?? 0,
          output: info.cost?.output ?? 0,
          cacheRead: info.cost?.cache_read ?? 0,
          cacheWrite: info.cost?.cache_write ?? 0,
          ...(tiers.length > 0 ? { tiers } : {}),
        },
        contextWindow: info.limit?.context ?? 0,
        maxTokens: info.limit?.output ?? 0,
        ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
      };
      return model;
    });
}

export function projectId(directory: string): string {
  return createHash('sha256').update(`directory:${directory}`).digest('hex');
}

export function sessionId(
  timestamp: number = Date.now(),
  random: Uint8Array = randomBytes(14),
): string {
  const value = ~(BigInt(timestamp) * 0x1000n + 1n);
  const time = Array.from({ length: 6 }, (_, index) =>
    Number((value >> BigInt(40 - 8 * index)) & 0xffn)
      .toString(16)
      .padStart(2, '0'),
  ).join('');
  return `ses_${time}${Array.from(random, (byte) => IDENTIFIER_CHARS[byte % 62]).join('')}`;
}

const OPENCODE_SESSION = sessionId();

export function opencodeHeaders(directory: string = process.cwd()): Record<string, string> {
  return {
    'User-Agent': `opencode/latest/${OPENCODE_VERSION}/cli`,
    'x-opencode-project': projectId(directory),
    'x-opencode-session': OPENCODE_SESSION,
  };
}

const opencodeDispatcher = new Agent({ connect: { ciphers: OPENCODE_CIPHERS } });

export const opencodeFetch = ((input: Parameters<typeof undiciFetch>[0], init?: RequestInit) =>
  undiciFetch(input, {
    ...(init as Parameters<typeof undiciFetch>[1]),
    dispatcher: opencodeDispatcher,
  })) as unknown as typeof globalThis.fetch;

export function withOpencodeEnvironment(
  context: TranscriptContext,
  directory: string = process.cwd(),
): TranscriptContext {
  const env = `<env>\n  Working directory: ${directory}\n</env>`;
  const [first, ...rest] = context.messages;
  const messages =
    first?.role === 'system'
      ? [{ ...first, sections: { ...first.sections, 'opencode-env': env } }, ...rest]
      : [
          {
            role: 'system',
            content: '',
            sections: { 'opencode-env': env },
            timestamp: Date.now(),
          } satisfies SystemMessage,
          ...context.messages,
        ];
  return { ...context, messages } as TranscriptContext;
}

export function streamOpencodeZen(
  model: Model<Api>,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const endpoint = endpoints[model.id];
  if (!endpoint) {
    return openAICompletionsApi().streamSimple(model, context, options);
  }

  const wrappedModel = {
    ...model,
    api: endpoint.api,
    baseUrl: endpoint.baseUrl,
  } as Model<Api>;

  const wrappedOptions: SimpleStreamOptions = {
    ...options,
    apiKey: resolveApiKey(options?.apiKey),
    fetch: options?.fetch ?? opencodeFetch,
    headers: { ...options?.headers, ...opencodeHeaders() },
  };
  const wrappedContext = withOpencodeEnvironment(context);

  switch (endpoint.api) {
    case 'anthropic-messages':
      return anthropicMessagesApi().streamSimple(wrappedModel, wrappedContext, wrappedOptions);
    case 'google-generative-ai':
      return googleGenerativeAIApi().streamSimple(wrappedModel, wrappedContext, wrappedOptions);
    case 'mistral-conversations':
      return mistralConversationsApi().streamSimple(wrappedModel, wrappedContext, wrappedOptions);
    case 'openai-responses':
      return openAIResponsesApi().streamSimple(wrappedModel, wrappedContext, wrappedOptions);
    case 'openai-completions':
      return openAICompletionsApi().streamSimple(wrappedModel, wrappedContext, wrappedOptions);
  }
}

export default async function (pi: ExtensionAPI) {
  const apiKey = getConfiguredApiKey();
  const provider = await fetchModelsDevProvider();

  pi.registerProvider('opencode-zen', {
    name: 'OpenCode Zen',
    baseUrl: provider?.api ?? OPENCODE_BASE_URL,
    apiKey: PUBLIC_API_KEY,
    api: 'openai-completions',
    streamSimple: streamOpencodeZen,
    models: buildModels(provider, isPublicMode(apiKey)),
  });
}
