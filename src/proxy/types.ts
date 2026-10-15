/**
 * Proxy contracts, types, and constants.
 */

export interface ProxyConfig {
  enabled: boolean;
  relayUrl: string;
  fallback: boolean;
  strictProxy: boolean;
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface ProxyStateSnapshot extends ProxyConfig {
  circuitState: CircuitState;
  isFallbackActive: boolean;
  consecutiveFailures: number;
}

export type ProxyStatusListener = (snapshot: ProxyStateSnapshot) => void;

export interface DeployVercelRelayOptions {
  vercelToken: string;
  projectName?: string;
  onProgress?: (message: string) => void;
  maxPollMs?: number;
  forceDeploy?: boolean;
  fetchImpl?: typeof globalThis.fetch;
}

export interface DeployVercelRelayResult {
  deployUrl: string;
  deploymentId: string;
  projectName: string;
  reused: boolean;
}

export interface ExistingVercelProject {
  exists: boolean;
  deployUrl?: string;
  deploymentId?: string;
  projectName?: string;
  projectId?: string;
  readyState?: string;
}

export const VERCEL_API = 'https://api.vercel.com';
export const DEFAULT_PROJECT_NAME = 'vercel-zen-relay';
export const PROXY_CONFIG_FILENAME = 'opencode-zen-proxy.json';
export const PROXY_STATUS_KEY = 'opencode-zen-proxy';
export const CIRCUIT_BREAKER_THRESHOLD = 2;
export const CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;
export const RELAY_CONNECT_TIMEOUT_MS = 7_000;

export const DEFAULT_PROXY_CONFIG: Readonly<ProxyConfig> = Object.freeze({
  enabled: false,
  relayUrl: '',
  fallback: true,
  strictProxy: false,
});
