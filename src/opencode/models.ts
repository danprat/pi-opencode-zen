/**
 * OpenCode Zen model catalog, aliases, models.dev synchronization, and offline cache.
 */

import type { Model } from '@earendil-works/pi-ai';
import type { Api } from '@earendil-works/pi-ai/compat';
import type { ProviderModelConfig } from '@earendil-works/pi-coding-agent';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  API_KEY,
  BASE_URL,
  MODELS_DEV_URL,
  USER_AGENT_V1,
  USER_AGENT_V2,
  type EndpointConfig,
  type ModelsDevModelInfo,
} from './types.ts';
import { proxyAwareFetch } from '../proxy/index.ts';

// Full static model catalog
export const allModels = [
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
    contextWindow: 1000000,
    maxTokens: 64000,
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    reasoning: true,
    input: ['text', 'image', 'pdf'],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 1000000,
    maxTokens: 128000,
  },
  {
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash (latest)',
    reasoning: true,
    input: ['text', 'image', 'pdf'],
    cost: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0.75 },
    contextWindow: 1000000,
    maxTokens: 64000,
  },
  {
    id: 'gemini-3-pro',
    name: 'Gemini 3 Pro (latest)',
    reasoning: true,
    input: ['text', 'image', 'pdf'],
    cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 3 },
    contextWindow: 1000000,
    maxTokens: 64000,
  },
  {
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro',
    reasoning: true,
    input: ['text', 'image', 'pdf'],
    cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 3 },
    contextWindow: 1000000,
    maxTokens: 64000,
  },
  {
    id: 'glm-4.6',
    name: 'GLM 4.6',
    reasoning: true,
    input: ['text'],
    cost: { input: 0.5, output: 2, cacheRead: 0.05, cacheWrite: 0.5 },
    contextWindow: 200000,
    maxTokens: 32000,
  },
  {
    id: 'glm-4.7',
    name: 'GLM 4.7 (latest)',
    reasoning: true,
    input: ['text'],
    cost: { input: 0.5, output: 2, cacheRead: 0.05, cacheWrite: 0.5 },
    contextWindow: 200000,
    maxTokens: 32000,
  },
  {
    id: 'glm-5',
    name: 'GLM 5 (latest)',
    reasoning: true,
    input: ['text'],
    cost: { input: 1, output: 4, cacheRead: 0.1, cacheWrite: 1 },
    contextWindow: 200000,
    maxTokens: 64000,
  },
  {
    id: 'gpt-5',
    name: 'GPT 5 (latest)',
    reasoning: true,
    input: ['text', 'image', 'pdf'],
    cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 2.5 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: 'gpt-5-codex',
    name: 'GPT 5 Codex (latest)',
    reasoning: true,
    input: ['text', 'image', 'pdf'],
    cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 2.5 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: 'gpt-5-nano',
    name: 'GPT 5 Nano',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0.05, output: 0.4, cacheRead: 0.005, cacheWrite: 0.1 },
    contextWindow: 200000,
    maxTokens: 32000,
  },
  {
    id: 'gpt-5.1',
    name: 'GPT 5.1 (latest)',
    reasoning: true,
    input: ['text', 'image', 'pdf'],
    cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 2.5 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: 'gpt-5.1-codex',
    name: 'GPT 5.1 Codex (latest)',
    reasoning: true,
    input: ['text', 'image', 'pdf'],
    cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 2.5 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: 'gpt-5.1-codex-max',
    name: 'GPT 5.1 Codex Max (latest)',
    reasoning: true,
    input: ['text', 'image', 'pdf'],
    cost: { input: 2.5, output: 20, cacheRead: 0.25, cacheWrite: 5 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: 'gpt-5.1-codex-mini',
    name: 'GPT 5.1 Codex Mini (latest)',
    reasoning: true,
    input: ['text', 'image', 'pdf'],
    cost: { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0.5 },
    contextWindow: 200000,
    maxTokens: 64000,
  },
  {
    id: 'gpt-5.2',
    name: 'GPT 5.2 (latest)',
    reasoning: true,
    input: ['text', 'image', 'pdf'],
    cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 3.5 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: 'gpt-5.2-codex',
    name: 'GPT 5.2 Codex (latest)',
    reasoning: true,
    input: ['text', 'image', 'pdf'],
    cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 3.5 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: 'gpt-5.3-codex',
    name: 'GPT 5.3 Codex (latest)',
    reasoning: true,
    input: ['text', 'image', 'pdf'],
    cost: { input: 2, output: 16, cacheRead: 0.2, cacheWrite: 4 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: 'gpt-5.3-codex-spark',
    name: 'GPT 5.3 Codex Spark',
    reasoning: true,
    input: ['text', 'image', 'pdf'],
    cost: { input: 2, output: 16, cacheRead: 0.2, cacheWrite: 4 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: 'gpt-5.4',
    name: 'GPT 5.4 (latest)',
    reasoning: true,
    input: ['text', 'image', 'pdf'],
    cost: { input: 2.5, output: 20, cacheRead: 0.25, cacheWrite: 5 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: 'gpt-5.4-mini',
    name: 'GPT 5.4 Mini',
    reasoning: true,
    input: ['text', 'image', 'pdf'],
    cost: { input: 0.35, output: 2.8, cacheRead: 0.035, cacheWrite: 0.7 },
    contextWindow: 200000,
    maxTokens: 64000,
  },
  {
    id: 'gpt-5.4-nano',
    name: 'GPT 5.4 Nano',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0.08, output: 0.6, cacheRead: 0.008, cacheWrite: 0.15 },
    contextWindow: 200000,
    maxTokens: 32000,
  },
  {
    id: 'gpt-5.4-pro',
    name: 'GPT 5.4 Pro',
    reasoning: true,
    input: ['text', 'image', 'pdf'],
    cost: { input: 5, output: 40, cacheRead: 0.5, cacheWrite: 10 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: 'kimi-k2',
    name: 'Kimi K2',
    reasoning: false,
    input: ['text'],
    cost: { input: 0.6, output: 2.5, cacheRead: 0.06, cacheWrite: 0.6 },
    contextWindow: 200000,
    maxTokens: 32000,
  },
  {
    id: 'kimi-k2-thinking',
    name: 'Kimi K2 Thinking',
    reasoning: true,
    input: ['text'],
    cost: { input: 0.8, output: 3.5, cacheRead: 0.08, cacheWrite: 0.8 },
    contextWindow: 200000,
    maxTokens: 64000,
  },
  {
    id: 'kimi-k2.5',
    name: 'Kimi K2.5 (latest)',
    reasoning: true,
    input: ['text'],
    cost: { input: 0.8, output: 3.5, cacheRead: 0.08, cacheWrite: 0.8 },
    contextWindow: 200000,
    maxTokens: 64000,
  },
  {
    id: 'minimax-m2.1',
    name: 'MiniMax M2.1',
    reasoning: true,
    input: ['text'],
    cost: { input: 0.4, output: 1.6, cacheRead: 0.04, cacheWrite: 0.4 },
    contextWindow: 200000,
    maxTokens: 32000,
  },
  {
    id: 'minimax-m2.5',
    name: 'MiniMax M2.5 (latest)',
    reasoning: true,
    input: ['text'],
    cost: { input: 0.5, output: 2, cacheRead: 0.05, cacheWrite: 0.5 },
    contextWindow: 200000,
    maxTokens: 64000,
  },
  {
    id: 'minimax-m2.5-free',
    name: 'MiniMax M2.5 Free',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 64000,
  },
  {
    id: 'muse-spark-1.2',
    name: 'Muse Spark 1.2',
    reasoning: true,
    input: ['text'],
    cost: { input: 0.5, output: 2, cacheRead: 0.05, cacheWrite: 0.5 },
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
    id: 'muse-spark-1.3',
    name: 'Muse Spark 1.3 (latest)',
    reasoning: true,
    input: ['text'],
    cost: { input: 0.75, output: 3, cacheRead: 0.075, cacheWrite: 0.75 },
    contextWindow: 128000,
    maxTokens: 32000,
  },
  {
    id: 'muse-spark-1.3-contributor-free',
    name: 'Muse Spark 1.3 Contributor Free (latest)',
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

export const endpoints: Record<string, EndpointConfig> = {
  // GPT models - openai-responses
  'gpt-5.4': { api: 'openai-responses', baseUrl: BASE_URL },
  'gpt-5.4-pro': { api: 'openai-responses', baseUrl: BASE_URL },
  'gpt-5.4-mini': { api: 'openai-responses', baseUrl: BASE_URL },
  'gpt-5.4-nano': { api: 'openai-responses', baseUrl: BASE_URL },
  'gpt-5.3-codex-spark': { api: 'openai-responses', baseUrl: BASE_URL },
  'gpt-5.3-codex': { api: 'openai-responses', baseUrl: BASE_URL },
  'gpt-5.2': { api: 'openai-responses', baseUrl: BASE_URL },
  'gpt-5.2-codex': { api: 'openai-responses', baseUrl: BASE_URL },
  'gpt-5.1': { api: 'openai-responses', baseUrl: BASE_URL },
  'gpt-5.1-codex-max': { api: 'openai-responses', baseUrl: BASE_URL },
  'gpt-5.1-codex': { api: 'openai-responses', baseUrl: BASE_URL },
  'gpt-5.1-codex-mini': { api: 'openai-responses', baseUrl: BASE_URL },
  'gpt-5': { api: 'openai-responses', baseUrl: BASE_URL },
  'gpt-5-codex': { api: 'openai-responses', baseUrl: BASE_URL },
  'gpt-5-nano': { api: 'openai-responses', baseUrl: BASE_URL },
  // Claude models - anthropic-messages
  'claude-opus-4-6': { api: 'anthropic-messages', baseUrl: BASE_URL },
  'claude-opus-4-5': { api: 'anthropic-messages', baseUrl: BASE_URL },
  'claude-opus-4-1': { api: 'anthropic-messages', baseUrl: BASE_URL },
  'claude-sonnet-4-6': { api: 'anthropic-messages', baseUrl: BASE_URL },
  'claude-sonnet-4-5': { api: 'anthropic-messages', baseUrl: BASE_URL },
  'claude-sonnet-4': { api: 'anthropic-messages', baseUrl: BASE_URL },
  'claude-haiku-4-5': { api: 'anthropic-messages', baseUrl: BASE_URL },
  'claude-3-5-haiku': { api: 'anthropic-messages', baseUrl: BASE_URL },
  // Gemini models - google-generative-ai
  'gemini-3.1-pro': { api: 'google-generative-ai', baseUrl: BASE_URL },
  'gemini-3-pro': { api: 'google-generative-ai', baseUrl: BASE_URL },
  'gemini-3-flash': { api: 'google-generative-ai', baseUrl: BASE_URL },
  // Muse models - openai-responses
  'muse-spark-1.3': { api: 'openai-responses', baseUrl: BASE_URL },
  'muse-spark-1.3-contributor-free': { api: 'openai-responses', baseUrl: BASE_URL },
  'muse-spark-1.2': { api: 'openai-responses', baseUrl: BASE_URL },
  'muse-spark-1.2-contributor-free': { api: 'openai-responses', baseUrl: BASE_URL },
  // GLM models - openai-completions
  'glm-5': { api: 'openai-completions', baseUrl: BASE_URL },
  'glm-4.7': { api: 'openai-completions', baseUrl: BASE_URL },
  'glm-4.6': { api: 'openai-completions', baseUrl: BASE_URL },
  // MiniMax models - openai-completions
  'minimax-m2.5': { api: 'openai-completions', baseUrl: BASE_URL },
  'minimax-m2.5-free': { api: 'openai-completions', baseUrl: BASE_URL },
  'minimax-m2.1': { api: 'openai-completions', baseUrl: BASE_URL },
  // Kimi models - openai-completions
  'kimi-k2.5': { api: 'openai-completions', baseUrl: BASE_URL },
  'kimi-k2': { api: 'openai-completions', baseUrl: BASE_URL },
  'kimi-k2-thinking': { api: 'openai-completions', baseUrl: BASE_URL },
  // Other models - openai-completions
  'big-pickle': { api: 'openai-completions', baseUrl: BASE_URL },
  'cat-jam-free': { api: 'openai-completions', baseUrl: BASE_URL },
  'ling-3.1-flash-free': { api: 'openai-completions', baseUrl: BASE_URL },
  'longcat-2.5-preview-free': { api: 'openai-completions', baseUrl: BASE_URL },
  'mimo-v2.6-flash-free': { api: 'openai-completions', baseUrl: BASE_URL },
  'nemotron-3.5-lightning-free': { api: 'openai-completions', baseUrl: BASE_URL },
  'space-bunny-free': { api: 'openai-completions', baseUrl: BASE_URL },
  'step-5-preview-free': { api: 'openai-completions', baseUrl: BASE_URL },
  'trinity-large-preview-free': { api: 'openai-completions', baseUrl: BASE_URL },
  'qwen3.6-plus-free': { api: 'openai-completions', baseUrl: BASE_URL },
  'nemotron-3-super-free': { api: 'openai-completions', baseUrl: BASE_URL },
};

export const MODEL_MAP: Record<string, string> = {
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

export const REASONING_MODEL_HINTS = [
  'muse',
  'mimo',
  'nemotron',
  'longcat',
  'cat-jam',
  'pickle',
  'ling',
  'step-',
];

export function isReasoningModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return REASONING_MODEL_HINTS.some((hint) => id.includes(hint));
}

export function computeEffectiveMaxTokens(
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

export function createModelConfig(
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

export const STATIC_MODELS: ProviderModelConfig[] = allModels.map((m) =>
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

export function getEffectiveApiKey(credentialKey?: string): string {
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

export async function fetchVisibleModelIds(
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
      const response = await proxyAwareFetch(url, init);
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

export async function fetchModelsDevInfo(
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

export function isPublicMode(apiKey?: string): boolean {
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

export function getVisibleModels(
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
            isReasoningModel(id),
            input,
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

export function getCacheFilePath(): string | undefined {
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

export function loadCachedModels(): ProviderModelConfig[] | undefined {
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

export function saveCachedModels(models: ProviderModelConfig[]): void {
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

export async function loadDynamicModels(
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
