/**
 * Proxy runtime state management and circuit breaker.
 */

import {
  CIRCUIT_BREAKER_COOLDOWN_MS,
  CIRCUIT_BREAKER_THRESHOLD,
  type CircuitState,
  type ProxyConfig,
  type ProxyStateSnapshot,
  type ProxyStatusListener,
} from './types.ts';
import {
  normalizeRelayUrl,
  resolveInitialProxyConfig,
  savePersistentProxyConfig,
} from './config.ts';

// Runtime Proxy State
let currentConfig: ProxyConfig = resolveInitialProxyConfig();
let consecutiveFailures = 0;
let lastFailureTimestamp = 0;
let circuitState: CircuitState = 'CLOSED';
let isFallbackActive = false;

const listeners = new Set<ProxyStatusListener>();

function emitStatusChange(): void {
  const snapshot = getProxyStateSnapshot();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch {
      // Ignore listener error
    }
  }
}

export function subscribeProxyStatus(listener: ProxyStatusListener): () => void {
  listeners.add(listener);
  listener(getProxyStateSnapshot());
  return () => {
    listeners.delete(listener);
  };
}

export function getProxyConfig(): Readonly<ProxyConfig> {
  return currentConfig;
}

export function updateCircuitBreakerState(): void {
  if (circuitState === 'OPEN') {
    const elapsed = Date.now() - lastFailureTimestamp;
    if (elapsed >= CIRCUIT_BREAKER_COOLDOWN_MS) {
      circuitState = 'HALF_OPEN';
    }
  }
}

export function getProxyStateSnapshot(): ProxyStateSnapshot {
  updateCircuitBreakerState();
  return {
    ...currentConfig,
    circuitState,
    isFallbackActive,
    consecutiveFailures,
  };
}

export function setProxyConfig(updates: Partial<ProxyConfig>, persist = true): ProxyStateSnapshot {
  currentConfig = {
    ...currentConfig,
    ...updates,
    relayUrl:
      updates.relayUrl !== undefined ? normalizeRelayUrl(updates.relayUrl) : currentConfig.relayUrl,
  };

  // If strictProxy changed, adjust fallback default accordingly
  if (updates.strictProxy !== undefined && updates.fallback === undefined) {
    currentConfig.fallback = !updates.strictProxy;
  }

  // Reset circuit breaker when toggling or updating URL
  consecutiveFailures = 0;
  circuitState = 'CLOSED';
  isFallbackActive = false;

  if (persist) {
    savePersistentProxyConfig(currentConfig);
  }

  emitStatusChange();
  return getProxyStateSnapshot();
}

export function toggleProxy(forceState?: boolean): ProxyStateSnapshot {
  const next = forceState !== undefined ? forceState : !currentConfig.enabled;
  return setProxyConfig({ enabled: next });
}

export function recordRelaySuccess(): void {
  consecutiveFailures = 0;
  circuitState = 'CLOSED';
  if (isFallbackActive) {
    isFallbackActive = false;
    emitStatusChange();
  }
}

export function recordRelayFailure(): void {
  consecutiveFailures++;
  lastFailureTimestamp = Date.now();
  if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitState = 'OPEN';
  }
  if (!isFallbackActive && currentConfig.fallback && !currentConfig.strictProxy) {
    isFallbackActive = true;
  }
  emitStatusChange();
}
