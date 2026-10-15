/**
 * Vercel REST API client for relay deployment, project checking, and status polling.
 */

import {
  DEFAULT_PROJECT_NAME,
  VERCEL_API,
  type DeployVercelRelayOptions,
  type DeployVercelRelayResult,
  type ExistingVercelProject,
} from './types.ts';
import { setProxyConfig } from './circuit.ts';
import { RELAY_FUNCTION_CODE, originalFetch } from './relay.ts';

async function pollDeployment(
  deploymentId: string,
  token: string,
  maxMs = 120_000,
  onProgress?: (msg: string) => void,
): Promise<{ url: string }> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const res = await originalFetch(`${VERCEL_API}/v13/deployments/${deploymentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`Failed to check deployment status (HTTP ${res.status})`);
    }
    const data = (await res.json()) as { readyState?: string; url?: string };
    if (data.readyState === 'READY' && data.url) {
      return { url: data.url };
    }
    if (data.readyState === 'ERROR' || data.readyState === 'CANCELED') {
      throw new Error(`Vercel deployment failed with readyState: ${data.readyState}`);
    }
    onProgress?.(`Waiting for deployment readiness (state: ${data.readyState || 'BUILDING'})...`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('Vercel deployment timed out');
}

export async function checkExistingVercelProject(
  token: string,
  projectName = DEFAULT_PROJECT_NAME,
  fetchImpl: typeof globalThis.fetch = originalFetch,
): Promise<ExistingVercelProject> {
  const trimmedToken = token.trim();
  if (!trimmedToken) {
    throw new Error('Vercel API token is required');
  }

  const res = await fetchImpl(`${VERCEL_API}/v9/projects/${encodeURIComponent(projectName)}`, {
    headers: { Authorization: `Bearer ${trimmedToken}` },
  });

  if (res.status === 404) {
    return { exists: false, projectName };
  }

  if (!res.ok) {
    throw new Error(`Failed to check Vercel project status (HTTP ${res.status})`);
  }

  const data = (await res.json()) as {
    id?: string;
    name?: string;
    targets?: {
      production?: {
        id?: string;
        readyState?: string;
        url?: string;
        alias?: string[];
      };
    };
  };

  const prod = data.targets?.production;
  const isReady = prod?.readyState === 'READY';
  const hostname = prod?.alias?.[0] || prod?.url;
  const deployUrl = isReady && hostname ? `https://${hostname}` : undefined;

  const result: ExistingVercelProject = {
    exists: true,
    projectName: data.name || projectName,
  };
  if (data.id) result.projectId = data.id;
  if (prod?.id) result.deploymentId = prod.id;
  if (prod?.readyState) result.readyState = prod.readyState;
  if (deployUrl) result.deployUrl = deployUrl;

  return result;
}

export async function deployVercelRelay(
  options: DeployVercelRelayOptions,
): Promise<DeployVercelRelayResult> {
  const token = options.vercelToken.trim();
  if (!token) {
    throw new Error('Vercel API token is required');
  }

  const projectName = options.projectName?.trim() || DEFAULT_PROJECT_NAME;
  const fetchImpl = options.fetchImpl ?? originalFetch;

  // Check if project already exists and has a ready production deployment
  if (!options.forceDeploy) {
    options.onProgress?.(`Checking for existing Vercel project "${projectName}"...`);
    try {
      const existing = await checkExistingVercelProject(token, projectName, fetchImpl);
      if (existing.exists && existing.deployUrl && existing.readyState === 'READY') {
        options.onProgress?.(
          `Found existing project "${projectName}". Connecting directly to ${existing.deployUrl}...`,
        );
        // Automatically save persistent configuration with the existing relay URL
        setProxyConfig({ relayUrl: existing.deployUrl, enabled: true });
        return {
          deployUrl: existing.deployUrl,
          deploymentId: existing.deploymentId || '',
          projectName,
          reused: true,
        };
      }
    } catch {
      // If check fails or project is not ready, proceed with deployment
    }
  }

  options.onProgress?.(`Initiating Vercel deployment for project "${projectName}"...`);

  const deployRes = await fetchImpl(`${VERCEL_API}/v13/deployments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: projectName,
      files: [
        {
          file: 'api/relay.js',
          data: RELAY_FUNCTION_CODE,
        },
        {
          file: 'package.json',
          data: JSON.stringify({ name: projectName, version: '1.0.0' }),
        },
        {
          file: 'vercel.json',
          data: JSON.stringify({
            rewrites: [{ source: '/(.*)', destination: '/api/relay' }],
          }),
        },
      ],
      projectSettings: {
        framework: null,
      },
      target: 'production',
    }),
  });

  if (!deployRes.ok) {
    const errBody = (await deployRes.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(
      errBody.error?.message || `Failed to create Vercel deployment (HTTP ${deployRes.status})`,
    );
  }

  const deployment = (await deployRes.json()) as {
    id?: string;
    uid?: string;
    projectId?: string;
  };
  const deploymentId = deployment.id || deployment.uid;
  if (!deploymentId) {
    throw new Error('Vercel did not return a deployment ID');
  }

  options.onProgress?.('Configuring project settings (disabling SSO deployment protection)...');
  const projectId = deployment.projectId || projectName;
  await fetchImpl(`${VERCEL_API}/v9/projects/${projectId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ssoProtection: null }),
  }).catch(() => {
    // Non-fatal if project patch returns warning
  });

  options.onProgress?.('Awaiting Vercel deployment ready state...');
  const ready = await pollDeployment(
    deploymentId,
    token,
    options.maxPollMs ?? 120_000,
    options.onProgress,
  );
  const deployUrl = `https://${ready.url}`;

  // Automatically update persistent configuration with the new relay URL
  setProxyConfig({ relayUrl: deployUrl, enabled: true });

  return {
    deployUrl,
    deploymentId,
    projectName,
    reused: false,
  };
}
