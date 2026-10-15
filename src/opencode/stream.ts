/**
 * OpenCode Zen streaming adapter and endpoint routing.
 */

import {
  type Api,
  type AssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
  type TranscriptContext,
  anthropicMessagesApi,
  googleGenerativeAIApi,
  openAICompletionsApi,
  openAIResponsesApi,
} from '@earendil-works/pi-ai/compat';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import {
  ANTHROPIC_MESSAGES_ENDPOINT,
  FREE_INFERENCE_BASE_URL,
  GOOGLE_GENERATIVE_AI_ENDPOINT,
  OPENAI_COMPLETIONS_ENDPOINT,
  OPENAI_RESPONSES_ENDPOINT,
  type EndpointConfig,
} from './types.ts';
import {
  computeEffectiveMaxTokens,
  endpoints,
  getEffectiveApiKey,
  isFreeModel,
  isPublicMode,
  normalizeModelId,
} from './models.ts';
import { opencodeHeaders } from './headers.ts';
import { ensureOpencodeGateTools } from './gate-tools.ts';
import { getProxyConfig, proxyAwareFetch } from '../proxy/index.ts';

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

  const proxyConfig = getProxyConfig();
  const isProxyActive = proxyConfig.enabled && Boolean(proxyConfig.relayUrl);

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
    ...(isProxyActive ? { fetch: proxyAwareFetch } : {}),
    ...(effectiveMaxTokens !== undefined ? { maxTokens: effectiveMaxTokens } : {}),
  };

  const gateContext = ensureOpencodeGateTools(context);

  switch (endpoint.api) {
    case 'anthropic-messages':
      return anthropicMessagesApi().streamSimple(wrappedModel, gateContext, wrappedOptions);
    case 'google-generative-ai': {
      // Google GenAI adapter disallows custom options.fetch; route via baseUrl if proxy is active
      const googleModel = isProxyActive
        ? ({ ...wrappedModel, baseUrl: proxyConfig.relayUrl } as Model<Api>)
        : wrappedModel;
      const googleHeaders = isProxyActive
        ? { ...wrappedOptions.headers, 'x-relay-target': 'https://opencode.ai' }
        : wrappedOptions.headers;
      const googleOptions: SimpleStreamOptions = {
        ...wrappedOptions,
      };
      delete (googleOptions as { fetch?: unknown }).fetch;
      if (googleHeaders !== undefined) {
        googleOptions.headers = googleHeaders;
      }

      if (!isProxyActive || !proxyConfig.fallback || proxyConfig.strictProxy) {
        return googleGenerativeAIApi().streamSimple(googleModel, gateContext, googleOptions);
      }

      // Proxy active with safe fallback: catch early connection/relay errors and fail over to direct
      const stream = createAssistantMessageEventStream();
      (async () => {
        try {
          const proxyStream = googleGenerativeAIApi().streamSimple(
            googleModel,
            gateContext,
            googleOptions,
          );
          let started = false;
          let failedEarly = false;
          for await (const event of proxyStream) {
            if (event.type === 'start' || event.type === 'text_delta') {
              started = true;
            }
            if (event.type === 'error' && !started) {
              failedEarly = true;
              break;
            }
            stream.push(event);
          }
          if (failedEarly) {
            const directStream = googleGenerativeAIApi().streamSimple(
              wrappedModel,
              gateContext,
              googleOptions,
            );
            for await (const event of directStream) {
              stream.push(event);
            }
          }
        } catch {
          const directStream = googleGenerativeAIApi().streamSimple(
            wrappedModel,
            gateContext,
            googleOptions,
          );
          for await (const event of directStream) {
            stream.push(event);
          }
        }
      })();
      return stream;
    }
    case 'openai-responses':
      return openAIResponsesApi().streamSimple(wrappedModel, gateContext, wrappedOptions);
    case 'openai-completions':
      return openAICompletionsApi().streamSimple(wrappedModel, gateContext, wrappedOptions);
  }
}
