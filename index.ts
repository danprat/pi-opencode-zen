import { Type } from '@earendil-works/pi-ai';
import {
  type Api,
  type AssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
  type Tool,
  type TranscriptContext,
  anthropicMessagesApi,
  googleGenerativeAIApi,
  openAICompletionsApi,
  openAIResponsesApi,
} from '@earendil-works/pi-ai/compat';
import type { RefreshModelsContext } from '@earendil-works/pi-ai';
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionUIContext,
  ProviderModelConfig,
} from '@earendil-works/pi-coding-agent';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type ProxyStateSnapshot,
  deployVercelRelay,
  getProxyStateSnapshot,
  installProxyFetchInterceptor,
  originalFetch,
  renderProxyStatusline,
  setProxyConfig,
  subscribeProxyStatus,
  toggleProxy,
  uninstallProxyFetchInterceptor,
} from './proxy.ts';

export * from './proxy.ts';

type Backend =
  'anthropic-messages' | 'google-generative-ai' | 'openai-completions' | 'openai-responses';

interface EndpointConfig {
  readonly api: Backend;
  readonly baseUrl: string;
}

interface ModelsDevModelInfo {
  name?: string;
  status?: string | null;
  reasoning?: boolean;
  modalities?: {
    input?: string[];
  };
  limit?: {
    context?: number;
    output?: number;
  };
  cost?: {
    input?: number | null;
    output?: number | null;
    cache_read?: number | null;
    cache_write?: number | null;
  } | null;
}

export const API_KEY = 'OPENCODE_API_KEY';
export const DEFAULT_BASE_URL = 'https://opencode.ai/inference/v1';
export const BASE_URL = process.env['OPENCODE_BASE_URL']?.trim() || DEFAULT_BASE_URL;
export const FREE_INFERENCE_BASE_URL = 'https://opencode.ai/inference/v1';
export const MODELS_DEV_URL = 'https://models.dev/api.json';

const OPENAI_RESPONSES_ENDPOINT: EndpointConfig = Object.freeze({
  api: 'openai-responses',
  baseUrl: BASE_URL,
});
const ANTHROPIC_MESSAGES_ENDPOINT: EndpointConfig = Object.freeze({
  api: 'anthropic-messages',
  baseUrl: BASE_URL,
});
const GOOGLE_GENERATIVE_AI_ENDPOINT: EndpointConfig = Object.freeze({
  api: 'google-generative-ai',
  baseUrl: BASE_URL,
});
const OPENAI_COMPLETIONS_ENDPOINT: EndpointConfig = Object.freeze({
  api: 'openai-completions',
  baseUrl: BASE_URL,
});

// Full model list - updated from models.dev
const allModels = [
  {
    id: 'big-pickle',
    name: 'Big Pickle',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 128000,
  },
  {
    id: 'cat-jam-free',
    name: 'Cat Jam Free',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131072,
    maxTokens: 32768,
  },
  {
    id: 'ling-3.1-flash-free',
    name: 'Ling 3.1 Flash Free',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131072,
    maxTokens: 32768,
  },
  {
    id: 'longcat-2.5-preview-free',
    name: 'LongCat 2.5 Preview Free',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 65536,
  },
  {
    id: 'mimo-v2.6-flash-free',
    name: 'MiMo V2.6 Flash Free',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 65536,
  },
  {
    id: 'nemotron-3.5-lightning-free',
    name: 'Nemotron 3.5 Lightning Free',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 65536,
  },
  {
    id: 'space-bunny-free',
    name: 'Space Bunny Free',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131072,
    maxTokens: 32768,
  },
  {
    id: 'step-5-preview-free',
    name: 'Step 5 Preview Free',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131072,
    maxTokens: 32768,
  },
  {
    id: 'claude-3-5-haiku',
    name: 'Claude 3.5 Haiku',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 8192,
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5 (latest)',
    reasoning: true,
    input: ['text', 'image', 'pdf'],
    cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    contextWindow: 200000,
    maxTokens: 64000,
  },
  {
    id: 'claude-opus-4-1',
    name: 'Claude Opus 4.1 (latest)',
    reasoning: true,
    input: ['text', 'image', 'pdf'],
    cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    contextWindow: 200000,
    maxTokens: 32000,
  },
  {
    id: 'claude-opus-4-5',
    name: 'Claude Opus 4.5 (latest)',
    reasoning: true,
    input: ['text', 'image', 'pdf'],
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    contextWindow: 200000,
    maxTokens: 64000,
  },
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    reasoning: true,
    input: ['text', 'image', 'pdf'],
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    contextWindow: 1000000,
    maxTokens: 128000,
  },
  {
    id: 'claude-sonnet-4',
    name: 'Claude Sonnet 4',
    reasoning: true,
    input: ['text', 'image', 'pdf'],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 1000000,
    maxTokens: 64000,
  },
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5 (latest)',
    reasoning: true,
    input: ['text', 'image', 'pdf'],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 200000,
    maxTokens: 64000,
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    reasoning: true,
    input: ['text', 'image', 'pdf'],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 1000000,
    maxTokens: 64000,
  },
  {
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash',
    reasoning: true,
    input: ['text', 'image', 'video', 'audio', 'pdf'],
    cost: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 65536,
  },
  {
    id: 'gemini-3-pro',
    name: 'Gemini 3 Pro',
    reasoning: true,
    input: ['text', 'image', 'video', 'audio', 'pdf'],
    cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 65536,
  },
  {
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro Preview',
    reasoning: true,
    input: ['text', 'image', 'video', 'audio', 'pdf'],
    cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 65536,
  },
  {
    id: 'glm-4.6',
    name: 'glm-4.6',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 202752,
    maxTokens: 131072,
  },
  {
    id: 'glm-4.7',
    name: 'glm-4.7',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 202752,
    maxTokens: 131072,
  },
  {
    id: 'glm-5',
    name: 'glm-5',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 202752,
    maxTokens: 131072,
  },
  {
    id: 'gpt-5',
    name: 'GPT-5',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: 'gpt-5-codex',
    name: 'GPT-5-Codex',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: 'gpt-5-nano',
    name: 'GPT-5 Nano',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0.05, output: 0.4, cacheRead: 0.005, cacheWrite: 0 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: 'gpt-5.1',
    name: 'GPT-5.1',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 1.25, output: 10, cacheRead: 0.13, cacheWrite: 0 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: 'gpt-5.1-codex',
    name: 'GPT-5.1 Codex',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: 'gpt-5.1-codex-max',
    name: 'GPT-5.1 Codex Max',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: 'gpt-5.1-codex-mini',
    name: 'GPT-5.1 Codex mini',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: 'gpt-5.2-codex',
    name: 'GPT-5.2 Codex',
    reasoning: true,
    input: ['text', 'image', 'pdf'],
    cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: 'gpt-5.3-codex',
    name: 'GPT-5.3 Codex',
    reasoning: true,
    input: ['text', 'image', 'pdf'],
    cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: 'gpt-5.3-codex-spark',
    name: 'GPT-5.3 Codex Spark',
    reasoning: true,
    input: ['text', 'image', 'pdf'],
    cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 32000,
  },
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    reasoning: true,
    input: ['text', 'image', 'pdf'],
    cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
    contextWindow: 1050000,
    maxTokens: 128000,
  },
  {
    id: 'gpt-5.4-mini',
    name: 'GPT-5.4 mini',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: 'gpt-5.4-nano',
    name: 'GPT-5.4 nano',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0.2, output: 1.25, cacheRead: 0.02, cacheWrite: 0 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: 'gpt-5.4-pro',
    name: 'GPT-5.4 Pro',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 30, output: 180, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1050000,
    maxTokens: 128000,
  },
  {
    id: 'kimi-k2',
    name: 'Kimi K2',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 128000,
  },
  {
    id: 'kimi-k2-thinking',
    name: 'kimi-k2-thinking',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 262144,
  },
  {
    id: 'kimi-k2.5',
    name: 'kimi-k2.5',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 262144,
  },
  {
    id: 'minimax-m2.1',
    name: 'minimax-m2.1',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 204800,
    maxTokens: 131072,
  },
  {
    id: 'minimax-m2.5',
    name: 'minimax-m2.5',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 204800,
    maxTokens: 131072,
  },
  {
    id: 'minimax-m2.5-free',
    name: 'MiniMax M2.5 Free',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 204800,
    maxTokens: 131072,
  },
  {
    id: 'muse-spark-1.3-contributor-free',
    name: 'Muse Spark 1.3 Contributor Free',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 32000,
  },
  {
    id: 'muse-spark-1.2-contributor-free',
    name: 'Muse Spark 1.2 Contributor Free',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 32000,
  },
  {
    id: 'nemotron-3-super-free',
    name: 'Nemotron 3 Super Free',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 204800,
    maxTokens: 128000,
  },
  {
    id: 'qwen3.6-plus-free',
    name: 'Qwen3.6 Plus Free',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 64000,
  },
  {
    id: 'trinity-large-preview-free',
    name: 'Trinity Large Preview',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131072,
    maxTokens: 131072,
  },
] as const;

const endpoints: Record<string, EndpointConfig> = {
  // GPT models - openai-responses
  'gpt-5.4': OPENAI_RESPONSES_ENDPOINT,
  'gpt-5.4-pro': OPENAI_RESPONSES_ENDPOINT,
  'gpt-5.4-mini': OPENAI_RESPONSES_ENDPOINT,
  'gpt-5.4-nano': OPENAI_RESPONSES_ENDPOINT,
  'gpt-5.3-codex-spark': OPENAI_RESPONSES_ENDPOINT,
  'gpt-5.3-codex': OPENAI_RESPONSES_ENDPOINT,
  'gpt-5.2': OPENAI_RESPONSES_ENDPOINT,
  'gpt-5.2-codex': OPENAI_RESPONSES_ENDPOINT,
  'gpt-5.1': OPENAI_RESPONSES_ENDPOINT,
  'gpt-5.1-codex-max': OPENAI_RESPONSES_ENDPOINT,
  'gpt-5.1-codex': OPENAI_RESPONSES_ENDPOINT,
  'gpt-5.1-codex-mini': OPENAI_RESPONSES_ENDPOINT,
  'gpt-5': OPENAI_RESPONSES_ENDPOINT,
  'gpt-5-codex': OPENAI_RESPONSES_ENDPOINT,
  'gpt-5-nano': OPENAI_RESPONSES_ENDPOINT,
  // Claude models - anthropic-messages
  'claude-opus-4-6': ANTHROPIC_MESSAGES_ENDPOINT,
  'claude-opus-4-5': ANTHROPIC_MESSAGES_ENDPOINT,
  'claude-opus-4-1': ANTHROPIC_MESSAGES_ENDPOINT,
  'claude-sonnet-4-6': ANTHROPIC_MESSAGES_ENDPOINT,
  'claude-sonnet-4-5': ANTHROPIC_MESSAGES_ENDPOINT,
  'claude-sonnet-4': ANTHROPIC_MESSAGES_ENDPOINT,
  'claude-haiku-4-5': ANTHROPIC_MESSAGES_ENDPOINT,
  'claude-3-5-haiku': ANTHROPIC_MESSAGES_ENDPOINT,
  // Gemini models - google-generative-ai
  'gemini-3.1-pro': GOOGLE_GENERATIVE_AI_ENDPOINT,
  'gemini-3-pro': GOOGLE_GENERATIVE_AI_ENDPOINT,
  'gemini-3-flash': GOOGLE_GENERATIVE_AI_ENDPOINT,
  // Muse models - openai-responses
  'muse-spark-1.3': OPENAI_RESPONSES_ENDPOINT,
  'muse-spark-1.3-contributor-free': OPENAI_RESPONSES_ENDPOINT,
  'muse-spark-1.2': OPENAI_RESPONSES_ENDPOINT,
  'muse-spark-1.2-contributor-free': OPENAI_RESPONSES_ENDPOINT,
  // GLM models - openai-completions
  'glm-5': OPENAI_COMPLETIONS_ENDPOINT,
  'glm-4.7': OPENAI_COMPLETIONS_ENDPOINT,
  'glm-4.6': OPENAI_COMPLETIONS_ENDPOINT,
  // MiniMax models - openai-completions
  'minimax-m2.5': OPENAI_COMPLETIONS_ENDPOINT,
  'minimax-m2.5-free': OPENAI_COMPLETIONS_ENDPOINT,
  'minimax-m2.1': OPENAI_COMPLETIONS_ENDPOINT,
  // Kimi models - openai-completions
  'kimi-k2.5': OPENAI_COMPLETIONS_ENDPOINT,
  'kimi-k2': OPENAI_COMPLETIONS_ENDPOINT,
  'kimi-k2-thinking': OPENAI_COMPLETIONS_ENDPOINT,
  // Other models - openai-completions
  'big-pickle': OPENAI_COMPLETIONS_ENDPOINT,
  'cat-jam-free': OPENAI_COMPLETIONS_ENDPOINT,
  'ling-3.1-flash-free': OPENAI_COMPLETIONS_ENDPOINT,
  'longcat-2.5-preview-free': OPENAI_COMPLETIONS_ENDPOINT,
  'mimo-v2.6-flash-free': OPENAI_COMPLETIONS_ENDPOINT,
  'nemotron-3.5-lightning-free': OPENAI_COMPLETIONS_ENDPOINT,
  'space-bunny-free': OPENAI_COMPLETIONS_ENDPOINT,
  'step-5-preview-free': OPENAI_COMPLETIONS_ENDPOINT,
  'trinity-large-preview-free': OPENAI_COMPLETIONS_ENDPOINT,
  'qwen3.6-plus-free': OPENAI_COMPLETIONS_ENDPOINT,
  'nemotron-3-super-free': OPENAI_COMPLETIONS_ENDPOINT,
};

const MODEL_MAP: Record<string, string> = {
  'muse-spark': 'muse-spark-1.3-contributor-free',
  'muse-spark-1.3': 'muse-spark-1.3-contributor-free',
  'muse-spark-1.2': 'muse-spark-1.2-contributor-free',
  mimo: 'mimo-v2.6-flash-free',
  'mimo-v2.5': 'mimo-v2.6-flash-free',
  'mimo-v2.5-free': 'mimo-v2.6-flash-free',
  'mimo-v2.6': 'mimo-v2.6-flash-free',
  nemotron: 'nemotron-3.5-lightning-free',
  'nemotron-3': 'nemotron-3.5-lightning-free',
  'nemotron-3-ultra': 'nemotron-3.5-lightning-free',
  'nemotron-3-ultra-free': 'nemotron-3.5-lightning-free',
  'nemotron-3.5': 'nemotron-3.5-lightning-free',
  ling: 'ling-3.1-flash-free',
  'ling-3': 'ling-3.1-flash-free',
  'ling-3.0-flash-fin-free': 'ling-3.1-flash-free',
  'ling-3.1': 'ling-3.1-flash-free',
  'space-bunny': 'space-bunny-free',
  'cat-jam': 'cat-jam-free',
  longcat: 'longcat-2.5-preview-free',
  'longcat-2.5': 'longcat-2.5-preview-free',
};

export function normalizeModelId(rawId: string): string {
  const stripped = rawId.replace(/^(opencode\/|oc\/|zen\/)/i, '');
  return MODEL_MAP[stripped] ?? stripped;
}

const REASONING_MODEL_HINTS = [
  'muse',
  'mimo',
  'nemotron',
  'longcat',
  'cat-jam',
  'pickle',
  'ling',
  'step-',
];

function isReasoningModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return REASONING_MODEL_HINTS.some((hint) => id.includes(hint));
}

function computeEffectiveMaxTokens(
  requested: number | undefined,
  modelId: string,
  reasoning?: string,
): number | undefined {
  if (requested === undefined) return undefined;
  const raw = Number(requested);
  const wanted = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 131072;
  const isReasoning = isReasoningModel(modelId) || (Boolean(reasoning) && reasoning !== 'off');
  const effective = isReasoning ? Math.max(wanted, 1024) + 4096 : Math.max(wanted, 512);
  return Math.min(effective, 131072);
}

function createModelConfig(
  id: string,
  name: string,
  reasoning: boolean,
  input: ('text' | 'image')[],
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number },
  contextWindow: number,
  maxTokens: number,
  thinkingLevelMap?: Model<Api>['thinkingLevelMap'],
): ProviderModelConfig {
  return {
    id,
    name,
    reasoning,
    input,
    cost,
    contextWindow,
    maxTokens,
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
  };
}

const STATIC_MODELS: ProviderModelConfig[] = allModels.map((m) =>
  createModelConfig(
    m.id,
    m.name,
    m.reasoning,
    (m.input as readonly string[]).filter(
      (value): value is 'text' | 'image' => value === 'text' || value === 'image',
    ),
    { ...m.cost },
    m.contextWindow,
    m.maxTokens,
    m.id.includes('muse') ? { off: 'low' } : undefined,
  ),
);

function getEffectiveApiKey(credentialKey?: string): string {
  if (credentialKey && credentialKey.trim().length > 0) {
    return credentialKey.trim();
  }
  const env = process.env[API_KEY]?.trim();
  if (env) return env;

  try {
    const agentDir =
      process.env['PI_AGENT_DIR'] ||
      (process.env['HOME'] ? join(process.env['HOME'], '.pi', 'agent') : undefined);
    if (agentDir) {
      const authPath = join(agentDir, 'auth.json');
      const auth = JSON.parse(readFileSync(authPath, 'utf8')) as Record<
        string,
        { key?: string; access?: string }
      >;
      const stored = auth?.['opencode-zen']?.key?.trim() || auth?.['opencode-zen']?.access?.trim();
      if (stored) return stored;
    }
  } catch {
    // Ignore fallback auth reading errors
  }
  return 'public';
}

async function fetchVisibleModelIds(
  apiKey: string,
  signal?: AbortSignal,
): Promise<Set<string> | undefined> {
  const isFree = isPublicMode(apiKey);
  const urls = [
    `${BASE_URL}/models`,
    'https://opencode.ai/inference/v1/models',
    'https://opencode.ai/zen/v1/models',
  ];
  for (const url of Array.from(new Set(urls))) {
    try {
      const init: RequestInit = {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': isFree ? USER_AGENT_V2 : USER_AGENT_V1,
          Accept: 'application/json',
        },
      };
      if (signal) init.signal = signal;
      const response = await fetch(url, init);
      if (!response.ok) continue;
      const json = (await response.json()) as { data?: Array<{ id?: string }> };
      return new Set(
        (json.data ?? [])
          .map((m) => m.id)
          .filter(
            (id): id is string =>
              typeof id === 'string' && id.length > 0 && !id.toLowerCase().startsWith('jev-'),
          ),
      );
    } catch {
      // try next fallback url
    }
  }
  return undefined;
}

async function fetchModelsDevInfo(
  signal?: AbortSignal,
): Promise<Record<string, ModelsDevModelInfo> | undefined> {
  try {
    const init: RequestInit = {};
    if (signal) init.signal = signal;
    const response = await fetch(MODELS_DEV_URL, init);
    if (!response.ok) return undefined;
    const json = (await response.json()) as {
      opencode?: { models?: Record<string, ModelsDevModelInfo> };
    };
    return json.opencode?.models;
  } catch {
    return undefined;
  }
}

function isPublicMode(apiKey?: string): boolean {
  return !apiKey || apiKey === 'public';
}

export function isFreeModel(id: string, model?: ModelsDevModelInfo): boolean {
  const lower = id.toLowerCase();
  if (lower.startsWith('jev-')) return false;
  if (lower.endsWith('-free') || lower.includes('-contributor') || lower === 'big-pickle') {
    return true;
  }
  const cost = model?.cost;
  if (!cost) return false;
  return (cost.input ?? 0) === 0;
}

function getVisibleModels(
  visibleIds?: Set<string>,
  modelsDevInfo?: Record<string, ModelsDevModelInfo>,
  publicMode = false,
): ProviderModelConfig[] {
  const modelMap = new Map<string, ProviderModelConfig>();

  for (const model of allModels) {
    const input = (model.input as readonly string[]).filter(
      (value): value is 'text' | 'image' => value === 'text' || value === 'image',
    );
    modelMap.set(
      model.id,
      createModelConfig(
        model.id,
        model.name,
        model.reasoning,
        input,
        { ...model.cost },
        model.contextWindow,
        model.maxTokens,
        model.id.includes('muse') ? { off: 'low' } : undefined,
      ),
    );
  }

  if (visibleIds) {
    for (const id of visibleIds) {
      if (id.toLowerCase().startsWith('jev-')) continue;
      const isMuse = id.toLowerCase().includes('muse');
      const dev = modelsDevInfo?.[id];
      if (dev && dev.status !== 'deprecated') {
        const input = (dev.modalities?.input ?? ['text']).filter(
          (value): value is 'text' | 'image' => value === 'text' || value === 'image',
        );
        modelMap.set(
          id,
          createModelConfig(
            id,
            dev.name || id,
            dev.reasoning ?? isReasoningModel(id),
            input.length > 0 ? input : ['text'],
            {
              input: dev.cost?.input ?? 0,
              output: dev.cost?.output ?? 0,
              cacheRead: dev.cost?.cache_read ?? 0,
              cacheWrite: dev.cost?.cache_write ?? 0,
            },
            dev.limit?.context ?? (isMuse ? 128000 : 200000),
            dev.limit?.output ?? (isMuse ? 32000 : 64000),
            isMuse ? { off: 'low' } : undefined,
          ),
        );
      } else if (!modelMap.has(id)) {
        modelMap.set(
          id,
          createModelConfig(
            id,
            id,
            isReasoningModel(id),
            ['text'],
            { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            isMuse ? 128000 : 200000,
            isMuse ? 32000 : 64000,
            isMuse ? { off: 'low' } : undefined,
          ),
        );
      }
    }
  }

  let models = Array.from(modelMap.values());

  if (visibleIds) {
    models = models.filter((m) => visibleIds.has(m.id));
  }

  if (modelsDevInfo) {
    models = models.filter((m) => modelsDevInfo[m.id]?.status !== 'deprecated');
  }

  if (publicMode) {
    models = models.filter((m) => isFreeModel(m.id, modelsDevInfo?.[m.id]));
  }

  return models;
}

const USER_AGENT_V2 = 'opencode/latest/2.0.29/cli';
const USER_AGENT_V1 = 'opencode/1.18.31 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14';
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function createOpencodeId(descending: boolean, timestamp = Date.now()): string {
  // Pinned to counter 1 like the upstream OpenCode CLI; non-small counters trip 403 FreeTierError
  const current = BigInt(timestamp) * 0x1000n + 1n;
  const value = descending ? ~current & ((1n << 48n) - 1n) : current & ((1n << 48n) - 1n);
  let time = '';
  for (let i = 0; i < 6; i++) {
    const byte = Number((value >> BigInt(40 - 8 * i)) & 0xffn);
    time += byte.toString(16).padStart(2, '0');
  }
  const randomBytes = crypto.getRandomValues(new Uint8Array(14));
  let randomStr = '';
  for (let i = 0; i < 14; i++) {
    randomStr += CHARS[(randomBytes[i] ?? 0) % 62] ?? '0';
  }
  return time + randomStr;
}

const activeSessionId = 'ses_' + createOpencodeId(true);
const sessionMap = new Map<string, string>();

function getSessionId(callerSessionId?: string): string {
  if (!callerSessionId) {
    return activeSessionId;
  }
  let existing = sessionMap.get(callerSessionId);
  if (!existing) {
    if (sessionMap.size >= 500) {
      const firstKey = sessionMap.keys().next().value;
      if (firstKey) sessionMap.delete(firstKey);
    }
    existing = 'ses_' + createOpencodeId(true);
    sessionMap.set(callerSessionId, existing);
  }
  return existing;
}

export function opencodeHeaders(sessionId?: string, isFree = true): Record<string, string> {
  const session = getSessionId(sessionId);
  if (isFree) {
    return {
      'User-Agent': USER_AGENT_V2,
      'x-opencode-client': 'cli',
      'x-opencode-session': session,
      'x-opencode-session-id': session,
      'x-session-affinity': session,
      'x-session-id': session,
      'x-opencode-project': 'global',
      Accept: 'text/event-stream',
    };
  }
  return {
    'User-Agent': USER_AGENT_V1,
    'x-opencode-client': 'desktop',
    'x-opencode-session': session,
    'x-opencode-session-id': session,
    'x-session-affinity': session,
    'x-session-id': session,
    'x-opencode-request': 'msg_' + createOpencodeId(false),
    'x-opencode-project': 'global',
    Accept: 'text/event-stream',
  };
}

export const GATE_TOOLS: readonly Tool[] = Object.freeze([
  {
    name: 'read',
    description:
      'Read the contents of a file or directory. Supports text files, images, and PDFs. Images and PDFs are presented directly to the model. Each text line is prefixed by its 1-based line number as <line>: <content>. The prefix is for reference and is not part of the file content. Directory entries are returned one per line. Use offset and limit to read large files or directories in sections. Prefer one larger read over many small slices, and use grep to find specific content in large files.',
    parameters: Type.Object(
      {
        path: Type.String({ description: 'File or directory to read' }),
        offset: Type.Optional(
          Type.Integer({
            minimum: 0,
            description: 'The line or directory entry to start reading from (1-based)',
          }),
        ),
        limit: Type.Optional(
          Type.Integer({
            minimum: 0,
            description:
              'The maximum number of lines or directory entries to read (defaults to and capped at 2000)',
          }),
        ),
      },
      { additionalProperties: false },
    ),
  },
  {
    name: 'shell',
    description:
      'Execute a shell command and return its output. Commands run on Linux using bash. Quote file paths containing spaces or special characters. Prefer dedicated tools over shell commands when possible. When output is large, the full result is saved to a file and a truncated preview is returned. Rely on automatic truncation unless filtering the output is more useful. Commands accept an optional timeout, background commands have no timeout by default. Background commands return immediately, and you will be notified when they complete. DO NOT poll for completion.',
    parameters: Type.Object(
      {
        command: Type.String({ description: 'Shell command string to execute' }),
        workdir: Type.Optional(
          Type.String({
            description:
              'Working directory to execute the command in. Defaults to the current working directory. When possible, avoid changing directories in the command and set the working directory here instead.',
          }),
        ),
        timeout: Type.Optional(
          Type.Integer({
            minimum: 0,
            description:
              'Timeout in milliseconds. Set to 0 to disable the timeout. Defaults to 120000 for foreground commands. Background commands have no timeout by default.',
          }),
        ),
        background: Type.Optional(
          Type.Boolean({
            description:
              "Run the command in the background and return immediately (useful for dev servers and long-running builds). You do not need to use '&' at the end of the command when using this parameter. You will be notified when it completes. DO NOT poll for completion.",
          }),
        ),
      },
      { additionalProperties: false },
    ),
  },
  {
    name: 'write',
    description: 'Write file',
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
  },
  {
    name: 'edit',
    description: 'Edit file',
    parameters: Type.Object({
      path: Type.String(),
      edits: Type.Array(
        Type.Object({
          oldText: Type.String(),
          newText: Type.String(),
        }),
      ),
    }),
  },
  {
    name: 'bash',
    description: 'Execute bash command',
    parameters: Type.Object({ command: Type.String() }),
  },
  {
    name: 'glob',
    description: 'Find files matching pattern',
    parameters: Type.Object({ pattern: Type.String() }),
  },
  {
    name: 'grep',
    description: 'Search files for pattern',
    parameters: Type.Object({ pattern: Type.String() }),
  },
]);

export function ensureOpencodeGateTools(context: TranscriptContext): TranscriptContext {
  const messages = [...context.messages];
  const first = messages[0];

  if (first && first.role === 'system') {
    const existing = first.toolsAdded;
    if (!existing || existing.length === 0) {
      messages[0] = { ...first, toolsAdded: GATE_TOOLS as Tool[] };
      return { ...context, messages };
    }
    // Retain existing tools while ensuring exact gate definitions for read and shell
    const tools = existing.map((t) => {
      const gateMatch = GATE_TOOLS.find((g) => g.name === t.name);
      return gateMatch ?? t;
    });
    const existingNames = new Set(tools.map((t) => t.name));
    const missing = GATE_TOOLS.filter((t) => !existingNames.has(t.name));
    messages[0] = { ...first, toolsAdded: [...tools, ...missing] };
  } else {
    messages.unshift({
      role: 'system',
      content: '',
      toolsAdded: GATE_TOOLS as Tool[],
      timestamp: 0,
    });
  }

  return { ...context, messages };
}

export function getEndpointConfig(modelId: string): EndpointConfig {
  const normalized = normalizeModelId(modelId);
  const direct = endpoints[normalized];
  if (direct) return direct;
  if (normalized.startsWith('claude-')) return ANTHROPIC_MESSAGES_ENDPOINT;
  if (normalized.startsWith('gemini-')) return GOOGLE_GENERATIVE_AI_ENDPOINT;
  if (
    normalized.startsWith('gpt-') ||
    normalized.startsWith('muse-') ||
    normalized.includes('muse')
  ) {
    return OPENAI_RESPONSES_ENDPOINT;
  }
  return OPENAI_COMPLETIONS_ENDPOINT;
}

export function streamOpencodeZen(
  model: Model<Api>,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  if (model.provider !== 'opencode-zen') {
    return openAICompletionsApi().streamSimple(model, context, options);
  }

  const normalizedId = normalizeModelId(model.id);
  const endpoint = getEndpointConfig(normalizedId);
  const isResponses = endpoint.api === 'openai-responses';

  const resolvedApiKey = options?.apiKey || getEffectiveApiKey();
  const effectiveMaxTokens = computeEffectiveMaxTokens(
    options?.maxTokens,
    normalizedId,
    options?.reasoning,
  );

  const isFree = isFreeModel(normalizedId) || isPublicMode(resolvedApiKey);
  // OpenCode v2 moved free inference from /zen/v1 to /inference/v1.
  // Any free inference request or legacy /zen/v1 URL is directed to /inference/v1.
  let targetBaseUrl = endpoint.baseUrl;
  if (isFree || targetBaseUrl.includes('/zen/v1')) {
    targetBaseUrl = targetBaseUrl.replace(/\/zen\/v1\/?$/, '/inference/v1');
    if (isFree && !targetBaseUrl.includes('/inference/v1')) {
      targetBaseUrl = FREE_INFERENCE_BASE_URL;
    }
  }

  const wrappedModel = {
    ...model,
    id: normalizedId,
    api: endpoint.api,
    baseUrl: targetBaseUrl,
    ...(isResponses ? { thinkingLevelMap: { off: 'low' } } : {}),
  } as Model<Api>;

  const wrappedOptions: SimpleStreamOptions = {
    ...options,
    apiKey: resolvedApiKey,
    headers: { ...options?.headers, ...opencodeHeaders(options?.sessionId, isFree) },
    ...(effectiveMaxTokens !== undefined ? { maxTokens: effectiveMaxTokens } : {}),
  };

  const gateContext = ensureOpencodeGateTools(context);

  switch (endpoint.api) {
    case 'anthropic-messages':
      return anthropicMessagesApi().streamSimple(wrappedModel, gateContext, wrappedOptions);
    case 'google-generative-ai':
      return googleGenerativeAIApi().streamSimple(wrappedModel, gateContext, wrappedOptions);
    case 'openai-responses':
      return openAIResponsesApi().streamSimple(wrappedModel, gateContext, wrappedOptions);
    case 'openai-completions':
      return openAICompletionsApi().streamSimple(wrappedModel, gateContext, wrappedOptions);
  }
}

function getCacheFilePath(): string | undefined {
  try {
    const agentDir =
      process.env['PI_AGENT_DIR'] ||
      (process.env['HOME'] ? join(process.env['HOME'], '.pi', 'agent') : undefined);
    if (!agentDir) return undefined;
    return join(agentDir, 'cache', 'opencode-zen-models.json');
  } catch {
    return undefined;
  }
}

function loadCachedModels(): ProviderModelConfig[] | undefined {
  const filePath = getCacheFilePath();
  if (!filePath) return undefined;
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as ProviderModelConfig[];
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch {
    // Cache miss or read error
  }
  return undefined;
}

function saveCachedModels(models: ProviderModelConfig[]): void {
  const filePath = getCacheFilePath();
  if (!filePath) return;
  try {
    const cacheDir = join(filePath, '..');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(filePath, JSON.stringify(models, null, 2), 'utf8');
  } catch {
    // Ignore cache write errors
  }
}

async function loadDynamicModels(
  apiKey?: string,
  signal?: AbortSignal,
): Promise<ProviderModelConfig[]> {
  const abortSignal = signal ?? AbortSignal.timeout(5000);
  try {
    const [visibleIds, modelsDevInfo] = await Promise.all([
      apiKey ? fetchVisibleModelIds(apiKey, abortSignal) : Promise.resolve(undefined),
      fetchModelsDevInfo(abortSignal),
    ]);

    const models = getVisibleModels(visibleIds, modelsDevInfo, isPublicMode(apiKey));
    if (models.length > 0) {
      saveCachedModels(models);
      return models;
    }
  } catch {
    // Fall back to cache or static on fetch failure or timeout
  }

  const cached = loadCachedModels();
  if (cached && cached.length > 0) {
    return cached;
  }

  return isPublicMode(apiKey) ? STATIC_MODELS.filter((m) => isFreeModel(m.id)) : STATIC_MODELS;
}

export async function refreshModels(context: RefreshModelsContext): Promise<ProviderModelConfig[]> {
  const apiKey = getEffectiveApiKey(
    context.credential?.type === 'api_key' ? context.credential.key : undefined,
  );
  if (!context.allowNetwork || context.signal.aborted) {
    const cached = loadCachedModels();
    return cached && cached.length > 0
      ? cached
      : isPublicMode(apiKey)
        ? STATIC_MODELS.filter((m) => isFreeModel(m.id))
        : STATIC_MODELS;
  }

  return loadDynamicModels(apiKey, context.signal);
}

export const PROXY_STATUS_KEY = 'opencode-zen-proxy';

let activeUi: ExtensionUIContext | undefined;

export function updateProxyStatusline(
  ui?: ExtensionUIContext,
  snapshot: ProxyStateSnapshot = getProxyStateSnapshot(),
): void {
  const targetUi = ui ?? activeUi;
  if (!targetUi) return;
  targetUi.setStatus(PROXY_STATUS_KEY, renderProxyStatusline(targetUi.theme, snapshot));
}

subscribeProxyStatus((snapshot) => {
  if (activeUi) {
    updateProxyStatusline(activeUi, snapshot);
  }
});

export async function opencodeZen(pi: ExtensionAPI): Promise<void> {
  installProxyFetchInterceptor();

  pi.on('session_start', async (_event, ctx) => {
    if (ctx.hasUI && ctx.ui) {
      activeUi = ctx.ui;
      updateProxyStatusline(ctx.ui);
    }
  });

  pi.on('session_shutdown', async () => {
    activeUi = undefined;
    uninstallProxyFetchInterceptor();
  });

  const handleZenProxyCommand = async (
    args: string,
    ctx: ExtensionCommandContext,
  ): Promise<void> => {
    activeUi = ctx.ui;
    const parts = args.trim().split(/\s+/).filter(Boolean);
    const subcommand = parts[0]?.toLowerCase() || 'status';

    switch (subcommand) {
      case 'on': {
        const snapshot = setProxyConfig({ enabled: true });
        updateProxyStatusline(ctx.ui, snapshot);
        if (!snapshot.relayUrl) {
          ctx.ui.notify(
            'Vercel proxy enabled, but no relay URL is set. Use `/zen-proxy set <url>` or `/zen-proxy deploy <token>`.',
            'warning',
          );
        } else {
          ctx.ui.notify(`Vercel proxy enabled (${snapshot.relayUrl})`, 'info');
        }
        break;
      }
      case 'off': {
        const snapshot = setProxyConfig({ enabled: false });
        updateProxyStatusline(ctx.ui, snapshot);
        ctx.ui.notify('Vercel proxy disabled', 'info');
        break;
      }
      case 'toggle': {
        const snapshot = toggleProxy();
        updateProxyStatusline(ctx.ui, snapshot);
        ctx.ui.notify(`Vercel proxy ${snapshot.enabled ? 'enabled' : 'disabled'}`, 'info');
        break;
      }
      case 'set': {
        let url = parts.slice(1).join(' ').trim();
        if (!url) {
          url = (await ctx.ui.input('Vercel Relay URL', 'https://your-relay.vercel.app')) || '';
        }
        if (!url) {
          ctx.ui.notify('No URL provided', 'warning');
          return;
        }
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = `https://${url}`;
        }
        const snapshot = setProxyConfig({ relayUrl: url, enabled: true });
        updateProxyStatusline(ctx.ui, snapshot);
        ctx.ui.notify(`Vercel relay URL configured to: ${snapshot.relayUrl}`, 'info');
        break;
      }
      case 'fallback': {
        const option = parts[1]?.toLowerCase();
        if (option === 'off' || option === 'disable' || option === 'false') {
          const snapshot = setProxyConfig({ fallback: false, strictProxy: true });
          updateProxyStatusline(ctx.ui, snapshot);
          ctx.ui.notify('Strict proxy mode enabled (direct fallback disabled)', 'warning');
        } else {
          const snapshot = setProxyConfig({ fallback: true, strictProxy: false });
          updateProxyStatusline(ctx.ui, snapshot);
          ctx.ui.notify('Seamless fallback to direct connection enabled', 'info');
        }
        break;
      }
      case 'strict': {
        const option = parts[1]?.toLowerCase();
        if (option === 'on' || option === 'enable' || option === 'true') {
          const snapshot = setProxyConfig({ fallback: false, strictProxy: true });
          updateProxyStatusline(ctx.ui, snapshot);
          ctx.ui.notify('Strict proxy mode enabled (direct fallback disabled)', 'warning');
        } else {
          const snapshot = setProxyConfig({ fallback: true, strictProxy: false });
          updateProxyStatusline(ctx.ui, snapshot);
          ctx.ui.notify('Strict proxy mode disabled (seamless direct fallback active)', 'info');
        }
        break;
      }
      case 'deploy': {
        let token = parts.slice(1).join(' ').trim();
        if (!token) {
          token =
            (await ctx.ui.input(
              'Deploy Vercel Relay',
              'Enter your Vercel Personal Access Token',
            )) || '';
        }
        if (!token) {
          ctx.ui.notify('Deployment cancelled: Vercel API token is required', 'warning');
          return;
        }
        ctx.ui.notify('Starting Vercel relay deployment...', 'info');
        try {
          const res = await deployVercelRelay({
            vercelToken: token,
            onProgress: (msg) => ctx.ui.notify(msg, 'info'),
          });
          updateProxyStatusline(ctx.ui);
          ctx.ui.notify(`Vercel relay deployed successfully! URL: ${res.deployUrl}`, 'info');
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`Vercel deployment failed: ${msg}`, 'error');
        }
        break;
      }
      case 'status':
      default: {
        const snapshot = getProxyStateSnapshot();
        updateProxyStatusline(ctx.ui, snapshot);

        const statusLines = [
          `OpenCode Zen Vercel Proxy:`,
          `• State: ${snapshot.enabled ? 'ON' : 'OFF'}`,
          `• Relay URL: ${snapshot.relayUrl || '(not configured)'}`,
          `• Fallback to Direct: ${snapshot.fallback && !snapshot.strictProxy ? 'Enabled' : 'Disabled (strict)'}`,
          `• Circuit Breaker: ${snapshot.circuitState}`,
        ];
        if (snapshot.isFallbackActive) {
          statusLines.push(`• Notice: Currently falling back to direct connection`);
        }

        ctx.ui.notify(statusLines.join('\n'), 'info');

        // Test connectivity if URL is set
        if (snapshot.relayUrl) {
          try {
            const probe = await originalFetch(snapshot.relayUrl, {
              headers: {
                'x-relay-target': 'https://opencode.ai',
                'x-relay-path': '/',
              },
              signal: AbortSignal.timeout(6000),
            });
            ctx.ui.notify(`Relay connectivity probe: HTTP ${probe.status}`, 'info');
          } catch (err) {
            const probeMsg = err instanceof Error ? err.message : String(err);
            ctx.ui.notify(`Relay connectivity probe failed: ${probeMsg}`, 'warning');
          }
        }
        break;
      }
    }
  };

  pi.registerCommand('zen-proxy', {
    description:
      'Manage OpenCode Zen Vercel proxy (on, off, toggle, set, status, deploy, fallback)',
    getArgumentCompletions: (prefix) => {
      const subcommands = ['on', 'off', 'toggle', 'status', 'set', 'fallback', 'strict', 'deploy'];
      const filtered = subcommands.filter((cmd) => cmd.startsWith(prefix.trim().toLowerCase()));
      return filtered.length > 0 ? filtered.map((cmd) => ({ value: cmd, label: cmd })) : null;
    },
    handler: async (args, ctx) => {
      await handleZenProxyCommand(args, ctx);
    },
  });

  const apiKey = getEffectiveApiKey();
  const models = await loadDynamicModels(apiKey);

  const envKey = process.env[API_KEY]?.trim();
  const configuredApiKey = envKey ? `$${API_KEY}` : apiKey;

  pi.registerProvider('opencode-zen', {
    baseUrl: BASE_URL,
    apiKey: configuredApiKey,
    api: 'openai-completions',
    streamSimple: streamOpencodeZen,
    models,
    refreshModels,
  });
}

export default opencodeZen;
