/**
 * OpenCode Zen extension entrypoint.
 *
 * Coordinates the pure OpenCode Zen provider subsystem (src/opencode/)
 * and the self-contained Vercel Edge relay proxy subsystem (src/proxy/).
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerOpencodeProvider } from './src/opencode/index.ts';
import { setupProxyExtension } from './src/proxy/index.ts';

// Re-export full OpenCode provider API for backwards compatibility
export * from './src/opencode/index.ts';

// Re-export full Proxy subsystem API for backwards compatibility
export * from './src/proxy/index.ts';

/**
 * Main extension factory loaded by Pi / Pi-Bolt.
 */
export async function opencodeZen(pi: ExtensionAPI): Promise<void> {
  // 1. Initialise Vercel Edge relay proxy controls, statusline hooks, and /zen command
  setupProxyExtension(pi);

  // 2. Register OpenCode Zen provider, models catalog, and streaming handlers
  await registerOpencodeProvider(pi);
}

export default opencodeZen;
