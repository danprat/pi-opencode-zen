/**
 * Statusline rendering, interactive /zen menu, and command management.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionUIContext,
  ThemeColor,
} from '@earendil-works/pi-coding-agent';
import { PROXY_STATUS_KEY, type ProxyStateSnapshot } from './types.ts';
import {
  getProxyStateSnapshot,
  setProxyConfig,
  subscribeProxyStatus,
  toggleProxy,
} from './circuit.ts';
import { originalFetch } from './relay.ts';
import { deployVercelRelay } from './vercel.ts';

let activeUi: ExtensionUIContext | undefined;
let currentProvider: string | undefined;

export function renderProxyStatusline(
  theme: { fg: (color: ThemeColor, text: string) => string },
  snapshot: ProxyStateSnapshot,
): string {
  if (!snapshot.enabled) {
    return theme.fg('dim', '🌐 Proxy: OFF');
  }

  if (!snapshot.relayUrl) {
    return theme.fg('warning', '⚠️ Proxy: No URL');
  }

  if (snapshot.isFallbackActive) {
    return theme.fg('warning', '⚠️ Proxy: Direct (Fallback)');
  }

  if (snapshot.circuitState === 'OPEN') {
    return theme.fg('warning', '⚠️ Proxy: Cooldown (Direct)');
  }

  return theme.fg('success', '⚡ Proxy: ON');
}

export function updateProxyStatusline(
  ui?: ExtensionUIContext,
  snapshot: ProxyStateSnapshot = getProxyStateSnapshot(),
  provider = currentProvider,
): void {
  const targetUi = ui ?? activeUi;
  if (!targetUi) return;

  // Only display the proxy indicator when using an opencode-zen model
  if (provider !== 'opencode-zen') {
    targetUi.setStatus(PROXY_STATUS_KEY, undefined);
    return;
  }

  targetUi.setStatus(PROXY_STATUS_KEY, renderProxyStatusline(targetUi.theme, snapshot));
}

subscribeProxyStatus((snapshot) => {
  if (activeUi) {
    updateProxyStatusline(activeUi, snapshot, currentProvider);
  }
});

export async function runInteractiveZenMenu(ctx: ExtensionCommandContext): Promise<void> {
  while (true) {
    const snapshot = getProxyStateSnapshot();
    updateProxyStatusline(ctx.ui, snapshot, currentProvider);

    const statusBadge = !snapshot.enabled
      ? '🔴 Disabled'
      : !snapshot.relayUrl
        ? '⚠️ Enabled (Missing URL)'
        : snapshot.isFallbackActive
          ? '⚠️ Active (Direct Fallback)'
          : '🟢 Active (Relaying via Vercel)';

    const shortUrl = snapshot.relayUrl
      ? snapshot.relayUrl.replace(/^https?:\/\//, '')
      : 'Not configured';

    const menuTitle = `OpenCode Zen Proxy Manager\nStatus: ${statusBadge}\nRelay: ${shortUrl}`;

    const toggleAction = snapshot.enabled
      ? '🔴 Turn Proxy OFF (Switch to direct connection)'
      : '🟢 Turn Proxy ON (Route traffic through Vercel relay)';

    const urlAction = snapshot.relayUrl
      ? `🔗 Change Relay URL (Current: ${shortUrl})`
      : '🔗 Set Relay URL (Enter an existing Vercel relay URL)';

    const deployAction = snapshot.relayUrl
      ? '🚀 Sync / Deploy Relay (Checks existing "vercel-zen-relay" or deploys new)'
      : '🚀 Setup Relay via Vercel Token (Auto-detects "vercel-zen-relay" or creates in 10s)';

    const fallbackAction =
      snapshot.fallback && !snapshot.strictProxy
        ? '🛡️ Auto Direct Fallback: ON (Safe: switches to direct if relay fails)'
        : '🛡️ Auto Direct Fallback: OFF (Strict: never leaks direct IP)';

    const testAction = '🩺 Test Relay Connection & Latency';
    const exitAction = '❌ Close Menu';

    const choice = await ctx.ui.select(menuTitle, [
      toggleAction,
      urlAction,
      deployAction,
      fallbackAction,
      testAction,
      exitAction,
    ]);

    if (!choice || choice === exitAction) {
      break;
    }

    if (choice === toggleAction) {
      const next = toggleProxy();
      updateProxyStatusline(ctx.ui, next, currentProvider);
      ctx.ui.notify(
        next.enabled
          ? `Vercel proxy enabled${next.relayUrl ? ` (${next.relayUrl})` : ' (no URL set)'}`
          : 'Vercel proxy disabled (direct connection active)',
        'info',
      );
    } else if (choice === urlAction) {
      const input = await ctx.ui.input(
        'Vercel Relay URL',
        snapshot.relayUrl || 'https://your-relay.vercel.app',
      );
      if (input && input.trim()) {
        let url = input.trim();
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = `https://${url}`;
        }
        const next = setProxyConfig({ relayUrl: url, enabled: true });
        updateProxyStatusline(ctx.ui, next, currentProvider);
        ctx.ui.notify(`Relay URL updated: ${next.relayUrl}`, 'info');
      }
    } else if (choice === deployAction) {
      const confirmed = await ctx.ui.confirm(
        'Deploy Vercel Edge Relay',
        'Deploy a private edge relay to your personal Vercel account.\n\nRequires a Vercel Personal Access Token from:\nhttps://vercel.com/account/tokens\n\nWould you like to deploy now?',
      );
      if (confirmed) {
        const token = await ctx.ui.input(
          'Vercel API Token',
          'Paste your Vercel personal access token (vcp_...)',
        );
        if (token && token.trim()) {
          ctx.ui.notify('Checking and deploying relay to Vercel...', 'info');
          try {
            const res = await deployVercelRelay({
              vercelToken: token.trim(),
              onProgress: (msg) => ctx.ui.notify(msg, 'info'),
            });
            updateProxyStatusline(ctx.ui, getProxyStateSnapshot(), currentProvider);
            if (res.reused) {
              ctx.ui.notify(
                `✓ Found existing project "${res.projectName}"! Connected to: ${res.deployUrl}`,
                'info',
              );
            } else {
              ctx.ui.notify(`✓ Relay deployed successfully! URL: ${res.deployUrl}`, 'info');
            }
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            ctx.ui.notify(`Vercel deployment failed: ${msg}`, 'error');
          }
        } else {
          ctx.ui.notify('Deployment cancelled: token not provided', 'warning');
        }
      }
    } else if (choice === fallbackAction) {
      const nextFallback = !snapshot.fallback || snapshot.strictProxy;
      const next = setProxyConfig({
        fallback: nextFallback,
        strictProxy: !nextFallback,
      });
      updateProxyStatusline(ctx.ui, next, currentProvider);
      ctx.ui.notify(
        next.fallback
          ? 'Safe fallback enabled: automatically switches to direct connection if relay fails'
          : 'Strict proxy mode enabled: direct fallback is disabled',
        next.fallback ? 'info' : 'warning',
      );
    } else if (choice === testAction) {
      if (!snapshot.relayUrl) {
        ctx.ui.notify('Cannot test connection: No relay URL configured.', 'warning');
      } else {
        ctx.ui.notify(`Testing connectivity to ${shortUrl}...`, 'info');
        const start = Date.now();
        try {
          const probe = await originalFetch(snapshot.relayUrl, {
            headers: {
              'x-relay-target': 'https://opencode.ai',
              'x-relay-path': '/inference/v1/models',
              Authorization: 'Bearer public',
            },
            signal: AbortSignal.timeout(8000),
          });
          const latency = Date.now() - start;
          if (probe.ok) {
            ctx.ui.notify(
              `✓ Relay is healthy! Latency: ${latency}ms (HTTP ${probe.status})`,
              'info',
            );
          } else {
            ctx.ui.notify(`⚠ Relay responded with HTTP ${probe.status} (${latency}ms)`, 'warning');
          }
        } catch (err) {
          const latency = Date.now() - start;
          const msg = err instanceof Error ? err.message : String(err);
          ctx.ui.notify(`❌ Relay unreachable (${latency}ms): ${msg}`, 'error');
        }
      }
    }
  }
}

export async function handleZenProxyCommand(
  args: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  activeUi = ctx.ui;
  currentProvider = ctx.model?.provider;
  const parts = args.trim().split(/\s+/).filter(Boolean);

  // If no argument provided in interactive mode, open the interactive UI menu
  if (parts.length === 0 && ctx.hasUI && ctx.mode === 'tui') {
    await runInteractiveZenMenu(ctx);
    return;
  }

  const subcommand = parts[0]?.toLowerCase() || 'status';

  switch (subcommand) {
    case 'menu': {
      if (ctx.hasUI && ctx.mode === 'tui') {
        await runInteractiveZenMenu(ctx);
      } else {
        ctx.ui.notify('Interactive menu is only available in TUI mode', 'warning');
      }
      break;
    }
    case 'on': {
      const snapshot = setProxyConfig({ enabled: true });
      updateProxyStatusline(ctx.ui, snapshot, currentProvider);
      if (!snapshot.relayUrl) {
        ctx.ui.notify(
          'Vercel proxy enabled, but no relay URL is set. Use `/zen set <url>` or `/zen deploy`.',
          'warning',
        );
      } else {
        ctx.ui.notify(`Vercel proxy enabled (${snapshot.relayUrl})`, 'info');
      }
      break;
    }
    case 'off': {
      const snapshot = setProxyConfig({ enabled: false });
      updateProxyStatusline(ctx.ui, snapshot, currentProvider);
      ctx.ui.notify('Vercel proxy disabled (direct connection)', 'info');
      break;
    }
    case 'toggle': {
      const snapshot = toggleProxy();
      updateProxyStatusline(ctx.ui, snapshot, currentProvider);
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
      updateProxyStatusline(ctx.ui, snapshot, currentProvider);
      ctx.ui.notify(`Vercel relay URL configured to: ${snapshot.relayUrl}`, 'info');
      break;
    }
    case 'fallback': {
      const option = parts[1]?.toLowerCase();
      if (option === 'off' || option === 'disable' || option === 'false') {
        const snapshot = setProxyConfig({ fallback: false, strictProxy: true });
        updateProxyStatusline(ctx.ui, snapshot, currentProvider);
        ctx.ui.notify('Strict proxy mode enabled (direct fallback disabled)', 'warning');
      } else {
        const snapshot = setProxyConfig({ fallback: true, strictProxy: false });
        updateProxyStatusline(ctx.ui, snapshot, currentProvider);
        ctx.ui.notify('Seamless fallback to direct connection enabled', 'info');
      }
      break;
    }
    case 'strict': {
      const option = parts[1]?.toLowerCase();
      if (option === 'on' || option === 'enable' || option === 'true') {
        const snapshot = setProxyConfig({ fallback: false, strictProxy: true });
        updateProxyStatusline(ctx.ui, snapshot, currentProvider);
        ctx.ui.notify('Strict proxy mode enabled (direct fallback disabled)', 'warning');
      } else {
        const snapshot = setProxyConfig({ fallback: true, strictProxy: false });
        updateProxyStatusline(ctx.ui, snapshot, currentProvider);
        ctx.ui.notify('Strict proxy mode disabled (seamless direct fallback active)', 'info');
      }
      break;
    }
    case 'deploy': {
      let token = parts.slice(1).join(' ').trim();
      if (!token) {
        const confirmed = await ctx.ui.confirm(
          'Deploy Vercel Edge Relay',
          'Deploy a private edge relay to your personal Vercel account.\n\nRequires a Vercel Personal Access Token from:\nhttps://vercel.com/account/tokens\n\nProceed?',
        );
        if (!confirmed) {
          ctx.ui.notify('Deployment cancelled', 'info');
          return;
        }
        token =
          (await ctx.ui.input(
            'Deploy Vercel Relay',
            'Enter your Vercel Personal Access Token (vcp_...)',
          )) || '';
      }
      if (!token) {
        ctx.ui.notify('Deployment cancelled: Vercel API token is required', 'warning');
        return;
      }
      ctx.ui.notify('Checking and deploying relay to Vercel...', 'info');
      try {
        const res = await deployVercelRelay({
          vercelToken: token,
          onProgress: (msg) => ctx.ui.notify(msg, 'info'),
        });
        updateProxyStatusline(ctx.ui, getProxyStateSnapshot(), currentProvider);
        if (res.reused) {
          ctx.ui.notify(
            `✓ Found existing project "${res.projectName}"! Connected to: ${res.deployUrl}`,
            'info',
          );
        } else {
          ctx.ui.notify(`✓ Vercel relay deployed successfully! URL: ${res.deployUrl}`, 'info');
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Vercel deployment failed: ${msg}`, 'error');
      }
      break;
    }
    case 'status':
    default: {
      const snapshot = getProxyStateSnapshot();
      updateProxyStatusline(ctx.ui, snapshot, currentProvider);

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
}

export const getZenCommandCompletions = (prefix: string) => {
  const subcommands = [
    'menu',
    'on',
    'off',
    'toggle',
    'status',
    'set',
    'fallback',
    'strict',
    'deploy',
  ];
  const filtered = subcommands.filter((cmd) => cmd.startsWith(prefix.trim().toLowerCase()));
  return filtered.length > 0 ? filtered.map((cmd) => ({ value: cmd, label: cmd })) : null;
};

export function setupProxyExtension(pi: ExtensionAPI): void {
  pi.on('session_start', async (_event, ctx) => {
    if (ctx.hasUI && ctx.ui) {
      activeUi = ctx.ui;
      currentProvider = ctx.model?.provider;
      updateProxyStatusline(ctx.ui, getProxyStateSnapshot(), currentProvider);
    }
  });

  pi.on('model_select', async (event, ctx) => {
    currentProvider = event.model?.provider;
    if (ctx.hasUI && ctx.ui) {
      activeUi = ctx.ui;
      updateProxyStatusline(ctx.ui, getProxyStateSnapshot(), currentProvider);
    }
  });

  pi.on('session_shutdown', async () => {
    activeUi = undefined;
    currentProvider = undefined;
  });

  pi.registerCommand('zen', {
    description: 'OpenCode Zen Proxy Manager interactive menu and controls',
    getArgumentCompletions: getZenCommandCompletions,
    handler: async (args, ctx) => {
      await handleZenProxyCommand(args, ctx);
    },
  });
}
