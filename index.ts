import {
  type Api,
  type AssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
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
import type { ExtensionAPI, ProviderModelConfig } from '@earendil-works/pi-coding-agent';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

export function getConfiguredApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const fromEnv = env[API_KEY_ENV]?.trim();
  if (fromEnv) return fromEnv;

  try {
    const authPath = join(env['HOME'] ?? '', '.pi', 'agent', 'auth.json');
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

/**
 * An OpenCode session identifier (`ses_` + a descending identifier). OpenCode derives these from
 * the timestamp and a counter; the Zen gateway only serves free models to requests that carry one.
 */
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
    headers: { ...options?.headers, ...opencodeHeaders() },
  };

  switch (endpoint.api) {
    case 'anthropic-messages':
      return anthropicMessagesApi().streamSimple(wrappedModel, context, wrappedOptions);
    case 'google-generative-ai':
      return googleGenerativeAIApi().streamSimple(wrappedModel, context, wrappedOptions);
    case 'mistral-conversations':
      return mistralConversationsApi().streamSimple(wrappedModel, context, wrappedOptions);
    case 'openai-responses':
      return openAIResponsesApi().streamSimple(wrappedModel, context, wrappedOptions);
    case 'openai-completions':
      return openAICompletionsApi().streamSimple(wrappedModel, context, wrappedOptions);
  }
}

export default async function (pi: ExtensionAPI): Promise<void> {
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
