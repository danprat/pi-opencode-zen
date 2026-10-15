/**
 * Proxy configuration persistence and environment resolution.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PROXY_CONFIG, PROXY_CONFIG_FILENAME, type ProxyConfig } from './types.ts';

function getProxyConfigFilePath(): string | undefined {
  try {
    const agentDir =
      process.env['PI_AGENT_DIR'] ||
      (process.env['HOME'] ? join(process.env['HOME'], '.pi', 'agent') : undefined);
    if (!agentDir) return undefined;
    return join(agentDir, PROXY_CONFIG_FILENAME);
  } catch {
    return undefined;
  }
}

export function loadPersistentProxyConfig(): Partial<ProxyConfig> {
  const filePath = getProxyConfigFilePath();
  if (!filePath) return {};
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<ProxyConfig>;
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed;
    }
  } catch {
    // Config file not present or unreadable
  }
  return {};
}

export function savePersistentProxyConfig(config: ProxyConfig): void {
  const filePath = getProxyConfigFilePath();
  if (!filePath) return;
  try {
    const dir = join(filePath, '..');
    mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
  } catch {
    // Ignore persistent write failures
  }
}

export function normalizeRelayUrl(url?: string | null): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '');
}

export function resolveInitialProxyConfig(): ProxyConfig {
  const persistent = loadPersistentProxyConfig();

  const envRelayUrl = normalizeRelayUrl(
    process.env['OPENCODE_VERCEL_PROXY_URL'] || process.env['VERCEL_PROXY_URL'],
  );
  const envEnabledRaw =
    process.env['OPENCODE_VERCEL_PROXY_ENABLED'] || process.env['VERCEL_PROXY_ENABLED'];
  const envStrictRaw =
    process.env['OPENCODE_VERCEL_PROXY_STRICT'] || process.env['VERCEL_PROXY_STRICT'];

  const relayUrl = persistent.relayUrl ? normalizeRelayUrl(persistent.relayUrl) : envRelayUrl;

  let enabled = DEFAULT_PROXY_CONFIG.enabled;
  if (persistent.enabled !== undefined) {
    enabled = Boolean(persistent.enabled);
  } else if (envEnabledRaw !== undefined) {
    enabled = envEnabledRaw.toLowerCase() === 'true' || envEnabledRaw === '1';
  } else if (relayUrl) {
    enabled = true;
  }

  let strictProxy = DEFAULT_PROXY_CONFIG.strictProxy;
  if (persistent.strictProxy !== undefined) {
    strictProxy = Boolean(persistent.strictProxy);
  } else if (envStrictRaw !== undefined) {
    strictProxy = envStrictRaw.toLowerCase() === 'true' || envStrictRaw === '1';
  }

  const fallback = persistent.fallback !== undefined ? Boolean(persistent.fallback) : !strictProxy;

  return {
    enabled,
    relayUrl,
    fallback,
    strictProxy,
  };
}
