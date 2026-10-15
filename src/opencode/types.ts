/**
 * OpenCode Zen types, backend definitions, and core constants.
 */

export type Backend =
  'anthropic-messages' | 'google-generative-ai' | 'openai-completions' | 'openai-responses';

export interface EndpointConfig {
  readonly api: Backend;
  readonly baseUrl: string;
}

export interface ModelsDevModelInfo {
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

export const USER_AGENT_V2 = 'opencode/latest/2.0.29/cli';
export const USER_AGENT_V1 = 'opencode/1.18.31 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14';
export const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export const OPENAI_RESPONSES_ENDPOINT: EndpointConfig = Object.freeze({
  api: 'openai-responses',
  baseUrl: BASE_URL,
});

export const ANTHROPIC_MESSAGES_ENDPOINT: EndpointConfig = Object.freeze({
  api: 'anthropic-messages',
  baseUrl: BASE_URL,
});

export const GOOGLE_GENERATIVE_AI_ENDPOINT: EndpointConfig = Object.freeze({
  api: 'google-generative-ai',
  baseUrl: BASE_URL,
});

export const OPENAI_COMPLETIONS_ENDPOINT: EndpointConfig = Object.freeze({
  api: 'openai-completions',
  baseUrl: BASE_URL,
});
