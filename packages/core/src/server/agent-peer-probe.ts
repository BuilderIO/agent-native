import crypto from "node:crypto";

import { ANTHROPIC_MANAGED_AGENTS_BETA_HEADER } from "../a2a/anthropic-managed-agents.js";
import { resolveA2ACallerAuth } from "../a2a/caller-auth.js";
import { A2AClient } from "../a2a/client.js";
import {
  RemoteAgentCredentialRejectedError,
  resolveRemoteAgentToken,
} from "../a2a/remote-agent-auth.js";
import { workspacePrivateOrigins } from "../a2a/workspace-private-origins.js";
import { ssrfSafeFetch } from "../extensions/url-safety.js";
import {
  loadCapabilities,
  type PeerCapabilities,
} from "./agent-capabilities.js";
import type { DiscoveredAgent } from "./agent-discovery.js";
import { getRequestOrgId, getRequestUserEmail } from "./request-context.js";

const AUTH_PROBE_TIMEOUT_MS = 6_000;
const PROBE_CONCURRENCY = 8;

export interface PeerProbeResult {
  url: string;
  reachable: boolean;
  cardStatus?: "reachable" | "auth-rejected" | "no-json-rpc";
  name?: string;
  description?: string;
  securitySchemes?: string[];
  authorized?: boolean;
  authError?: string;
  publicSkills?: number;
  error?: string;
}

export interface PeerProbeDeps {
  loadCapabilities: (
    agent: DiscoveredAgent,
    options?: { authenticate?: boolean },
  ) => Promise<PeerCapabilities>;
  resolveCallerAuth: typeof resolveA2ACallerAuth;
  resolveRemoteAgentToken: typeof resolveRemoteAgentToken;
  fetch: typeof fetch;
  createClient: (
    baseUrl: string,
    apiKey?: string,
    options?: {
      requestTimeoutMs?: number;
      fallbackApiKeys?: string[];
      cardUrl?: string;
    },
  ) => Pick<A2AClient, "getTask">;
}

const defaultPeerProbeDeps: PeerProbeDeps = {
  loadCapabilities,
  resolveCallerAuth: resolveA2ACallerAuth,
  resolveRemoteAgentToken,
  fetch: safeProbeFetch,
  createClient: (baseUrl, apiKey, options) =>
    new A2AClient(baseUrl, apiKey, options),
};

export async function probePeerAgent(
  agent: DiscoveredAgent,
  deps: PeerProbeDeps = defaultPeerProbeDeps,
  options?: { verifyAuth?: boolean },
): Promise<PeerProbeResult> {
  if (agent.kind?.provider === "anthropic-managed-agents") {
    return probeAnthropicManagedAgent(agent, deps);
  }
  const capabilities = await deps.loadCapabilities(agent, {
    authenticate: options?.verifyAuth !== false,
  });
  if (capabilities.skills === null || !capabilities.card) {
    return {
      url: agent.url,
      reachable: capabilities.cardStatus === "auth-rejected",
      ...(capabilities.cardStatus
        ? { cardStatus: capabilities.cardStatus }
        : {}),
      error: capabilities.error ?? "unreachable",
    };
  }

  const card = capabilities.card;
  const result: PeerProbeResult = {
    url: agent.url,
    reachable: true,
    ...(capabilities.cardStatus ? { cardStatus: capabilities.cardStatus } : {}),
    name: card.name,
    description: capabilities.cardDescription,
    securitySchemes: card.securitySchemes
      ? Object.keys(card.securitySchemes)
      : undefined,
    publicSkills: capabilities.skills.length,
  };

  if (capabilities.cardStatus === "no-json-rpc") return result;
  if (options?.verifyAuth === false) return result;

  const auth = agent.auth ? undefined : await deps.resolveCallerAuth();
  let apiKey: string | undefined;
  try {
    apiKey = agent.auth
      ? await deps.resolveRemoteAgentToken(agent.auth, {
          userEmail: getRequestUserEmail(),
          orgId: getRequestOrgId(),
        })
      : auth?.apiKey;
  } catch (error) {
    const statusCode =
      typeof (error as { statusCode?: unknown })?.statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : undefined;
    if (statusCode === 401 || statusCode === 403) {
      result.cardStatus = "auth-rejected";
    }
    result.authError = error instanceof Error ? error.message : String(error);
    return result;
  }
  const client = deps.createClient(agent.url, apiKey, {
    requestTimeoutMs: AUTH_PROBE_TIMEOUT_MS,
    ...(auth?.apiKeyFallbacks ? { fallbackApiKeys: auth.apiKeyFallbacks } : {}),
    ...(agent.cardUrl ? { cardUrl: agent.cardUrl } : {}),
  });

  try {
    await client.getTask(`probe-${crypto.randomUUID()}`, {
      requestTimeoutMs: AUTH_PROBE_TIMEOUT_MS,
    });
    result.authorized = true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof RemoteAgentCredentialRejectedError) {
      result.authorized = false;
      result.cardStatus = "auth-rejected";
      result.authError = String(err.status);
    } else if (/A2A request failed \((401|403)\)/.test(message)) {
      result.authorized = false;
      result.authError = /403/.test(message) ? "403" : "401";
    } else if (/A2A error \(-?\d+\): task not found/i.test(message)) {
      result.authorized = true;
    } else {
      result.authError = message;
    }
  }

  return result;
}

export async function probeAllPeerAgents(
  agents: DiscoveredAgent[],
  deps: PeerProbeDeps = defaultPeerProbeDeps,
): Promise<Array<PeerProbeResult & { id: string }>> {
  const results: Array<PeerProbeResult & { id: string }> = [];
  for (let i = 0; i < agents.length; i += PROBE_CONCURRENCY) {
    const batch = agents.slice(i, i + PROBE_CONCURRENCY);
    results.push(
      ...(await Promise.all(
        batch.map(async (agent) => ({
          id: agent.id,
          ...(await probePeerAgent(agent, deps)),
        })),
      )),
    );
  }
  return results;
}

async function probeAnthropicManagedAgent(
  agent: DiscoveredAgent,
  deps: PeerProbeDeps,
): Promise<PeerProbeResult> {
  const kind = agent.kind;
  if (kind?.provider !== "anthropic-managed-agents") {
    return {
      url: agent.url,
      reachable: false,
      error: "managed agent config missing",
    };
  }

  let apiKey: string | undefined;
  try {
    apiKey = await deps.resolveRemoteAgentToken(
      { type: "bearer", credentialRef: kind.credentialRef },
      { userEmail: getRequestUserEmail(), orgId: getRequestOrgId() },
    );
  } catch (error) {
    if (error instanceof RemoteAgentCredentialRejectedError) {
      return {
        url: agent.url,
        reachable: true,
        cardStatus: "auth-rejected",
        authorized: false,
        authError: String(error.status),
      };
    }
    return {
      url: agent.url,
      reachable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (!apiKey?.trim()) {
    return {
      url: agent.url,
      reachable: false,
      error:
        "The configured Anthropic Managed Agents credential is not available.",
    };
  }

  const endpoint = `${agent.url.replace(/\/+$/, "")}/v1/agents/${encodeURIComponent(kind.agentId)}`;
  let response: Response;
  try {
    response = await deps.fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "anthropic-beta": ANTHROPIC_MANAGED_AGENTS_BETA_HEADER,
        "anthropic-version": "2023-06-01",
        "x-api-key": apiKey.trim(),
      },
      signal: AbortSignal.timeout(AUTH_PROBE_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      url: agent.url,
      reachable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      url: agent.url,
      reachable: true,
      cardStatus: "auth-rejected",
      authorized: false,
      authError: String(response.status),
    };
  }
  if (response.status === 404) {
    return {
      url: agent.url,
      reachable: false,
      error: `Anthropic Managed Agent "${kind.agentId}" was not found (HTTP 404).`,
    };
  }
  if (!response.ok) {
    return {
      url: agent.url,
      reachable: false,
      error: `Anthropic Managed Agents probe returned HTTP ${response.status}.`,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    return {
      url: agent.url,
      reachable: false,
      error: `Anthropic Managed Agents probe returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      url: agent.url,
      reachable: false,
      error: "Anthropic Managed Agents probe returned an invalid agent.",
    };
  }
  const resource = payload as Record<string, unknown>;
  return {
    url: agent.url,
    reachable: true,
    cardStatus: "reachable",
    authorized: true,
    ...(typeof resource.name === "string" ? { name: resource.name } : {}),
    ...(typeof resource.description === "string"
      ? { description: resource.description }
      : {}),
  };
}

function safeProbeFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  return ssrfSafeFetch(url, init, {
    maxRedirects: 0,
    followRedirects: false,
    allowedPrivateOrigins: workspacePrivateOrigins(),
  });
}
