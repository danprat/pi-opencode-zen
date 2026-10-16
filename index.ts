import {
  type Api,
  type AssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
  type TranscriptContext,
} from '@earendil-works/pi-ai';
import {
  anthropicMessagesApi,
  googleGenerativeAIApi,
  openAICompletionsApi,
  openAIResponsesApi,
} from '@earendil-works/pi-ai/compat';
import type { ExtensionAPI, ProviderModelConfig } from '@earendil-works/pi-coding-agent';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Backend =
  'anthropic-messages' | 'google-generative-ai' | 'openai-completions' | 'openai-responses';

interface EndpointConfig {
  api: Backend;
  baseUrl: string;
}

interface ModelsDevModelInfo {
  name?: string | null;
  status?: string | null;
  reasoning?: boolean | null;
  modalities?: { input?: string[] | null } | null;
  limit?: { context?: number | null; output?: number | null } | null;
  provider?: { npm?: string | null } | null;
  cost?: {
    input?: number | null;
    output?: number | null;
    cache_read?: number | null;
    cache_write?: number | null;
  } | null;
}

const API_KEY = 'OPENCODE_API_KEY';
const BASE_URL = 'https://opencode.ai/zen/v1';
const MODELS_DEV_URL = 'https://models.dev/api.json';

const backendsByNpm: Record<string, Backend> = {
  '@ai-sdk/anthropic': 'anthropic-messages',
  '@ai-sdk/google': 'google-generative-ai',
  '@ai-sdk/openai': 'openai-responses',
};

const endpoints: Record<string, EndpointConfig> = {};

function getConfiguredApiKey(): string | undefined {
  const env = process.env[API_KEY]?.trim();
  if (env) return env;

  try {
    const authPath = join(process.env['HOME'] ?? '', '.pi', 'agent', 'auth.json');
    const auth = JSON.parse(readFileSync(authPath, 'utf8')) as Record<string, { key?: string }>;
    const key = auth?.['opencode-zen']?.key?.trim();
    return key || undefined;
  } catch {
    return undefined;
  }
}

async function fetchVisibleModelIds(apiKey: string): Promise<Set<string> | undefined> {
  try {
    const response = await fetch(`${BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, ...opencodeHeaders() },
    });
    if (!response.ok) return undefined;
    const json = (await response.json()) as { data?: Array<{ id?: string }> };
    return new Set((json.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id)));
  } catch {
    return undefined;
  }
}

async function fetchModelsDevInfo(): Promise<Record<string, ModelsDevModelInfo> | undefined> {
  try {
    const response = await fetch(MODELS_DEV_URL);
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

function isFreeModel(model: ModelsDevModelInfo | undefined): boolean {
  const cost = model?.cost;
  if (!cost) return false;
  return (cost.input ?? 0) === 0;
}

function getVisibleModels(
  visibleIds?: Set<string>,
  modelsDevInfo?: Record<string, ModelsDevModelInfo>,
  publicMode = false,
): ProviderModelConfig[] {
  if (!modelsDevInfo) return [];
  let ids = Object.keys(modelsDevInfo);
  if (visibleIds) ids = ids.filter((id) => visibleIds.has(id));
  ids = ids.filter((id) => modelsDevInfo[id]?.status !== 'deprecated');
  if (publicMode) ids = ids.filter((id) => isFreeModel(modelsDevInfo[id]));
  return ids.map((id) => {
    const info = modelsDevInfo[id] ?? {};
    endpoints[id] = {
      api: backendsByNpm[info.provider?.npm ?? ''] ?? 'openai-completions',
      baseUrl: BASE_URL,
    };
    const input = (info.modalities?.input ?? ['text']).filter(
      (value): value is 'text' | 'image' => value === 'text' || value === 'image',
    );
    return {
      id,
      name: info.name ?? id,
      reasoning: info.reasoning ?? false,
      input,
      cost: {
        input: info.cost?.input ?? 0,
        output: info.cost?.output ?? 0,
        cacheRead: info.cost?.cache_read ?? 0,
        cacheWrite: info.cost?.cache_write ?? 0,
      },
      contextWindow: info.limit?.context ?? 0,
      maxTokens: info.limit?.output ?? 0,
    };
  });
}

function opencodeHeaders(): Record<string, string> {
  const id = () => crypto.randomUUID().replace(/-/g, '').slice(0, 26);
  return {
    'User-Agent': 'opencode/latest/1.3.15/cli',
    'x-opencode-client': 'cli',
    'x-opencode-session': id(),
    'x-opencode-project': id(),
    'x-opencode-request': id(),
  };
}

function streamOpencodeZen(
  model: Model<Api>,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const endpoint = endpoints[model.id];
  if (!endpoint || model.provider !== 'opencode-zen') {
    return openAICompletionsApi().streamSimple(model, context, options);
  }

  const wrappedModel = {
    ...model,
    api: endpoint.api,
    baseUrl: endpoint.baseUrl,
  } as Model<Api>;

  const wrappedOptions: SimpleStreamOptions = {
    ...options,
    headers: { ...opencodeHeaders(), ...options?.headers },
  };

  switch (endpoint.api) {
    case 'anthropic-messages':
      return anthropicMessagesApi().streamSimple(wrappedModel, context, wrappedOptions);
    case 'google-generative-ai':
      return googleGenerativeAIApi().streamSimple(wrappedModel, context, wrappedOptions);
    case 'openai-responses':
      return openAIResponsesApi().streamSimple(wrappedModel, context, wrappedOptions);
    case 'openai-completions':
      return openAICompletionsApi().streamSimple(wrappedModel, context, wrappedOptions);
  }
}

export default async function (pi: ExtensionAPI): Promise<void> {
  const apiKey = getConfiguredApiKey();
  const [visibleIds, modelsDevInfo] = await Promise.all([
    apiKey ? fetchVisibleModelIds(apiKey) : Promise.resolve(undefined),
    fetchModelsDevInfo(),
  ]);

  pi.registerProvider('opencode-zen', {
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    api: 'openai-completions',
    streamSimple: streamOpencodeZen,
    models: getVisibleModels(visibleIds, modelsDevInfo, isPublicMode(apiKey)),
  });
}
