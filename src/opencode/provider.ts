/**
 * OpenCode Zen provider registration and catalog refresh handler.
 */

import type { RefreshModelsContext } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ProviderModelConfig } from '@earendil-works/pi-coding-agent';
import { API_KEY, BASE_URL } from './types.ts';
import {
  getEffectiveApiKey,
  isFreeModel,
  isPublicMode,
  loadCachedModels,
  loadDynamicModels,
  STATIC_MODELS,
} from './models.ts';
import { streamOpencodeZen } from './stream.ts';

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

export async function registerOpencodeProvider(pi: ExtensionAPI): Promise<void> {
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
