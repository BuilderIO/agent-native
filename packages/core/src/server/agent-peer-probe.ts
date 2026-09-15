import crypto from "node:crypto";

import { resolveA2ACallerAuth } from "../a2a/caller-auth.js";
import { A2AClient } from "../a2a/client.js";
import {
  RemoteAgentCredentialRejectedError,
  resolveRemoteAgentToken,
} from "../a2a/remote-agent-auth.js";
import {
  loadCapabilities,
  type PeerCapabilities,
} from "./agent-capabilities.js";
import type { DiscoveredAgent } from "./agent-discovery.js";
import { getRequestOrgId, getRequestUserEmail } from "./request-context.js";

const AUTH_PROBE_TIMEOUT_MS = 6_000;
/** Matches CARD_CONCURRENCY in agent-capabilities.ts — bounds simultaneous
 * outbound probes the same way card loading already does. */
const PROBE_CONCURRENCY = 8;

export interface PeerProbeResult {
  url: string;
  reachable: boolean;
  cardStatus?: "reachable" | "auth-rejected" | "no-json-rpc";
  name?: string;
  description?: string;
  securitySchemes?: string[];
  /** Absent (not false) whenever the auth check never ran or never resolved. */
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
  createClient: (baseUrl, apiKey, options) =>
    new A2AClient(baseUrl, apiKey, options),
};

/**
 * Probe one peer: does its agent card load (reachability), and separately,
 * will OUR calls to it authenticate. These two questions must never collapse
 * into one boolean — an unreachable peer can't tell us anything about auth,
 * so `authorized` stays absent rather than `false` in that case, and a
 * transport failure on the auth-only call (timeout, DNS, 5xx) must never be
 * reported as an auth rejection either.
 */
export async function probePeerAgent(
  agent: DiscoveredAgent,
  deps: PeerProbeDeps = defaultPeerProbeDeps,
  options?: { verifyAuth?: boolean },
): Promise<PeerProbeResult> {
  const capabilities = await deps.loadCapabilities(agent, {
    authenticate: options?.verifyAuth !== false,
  });
  if (capabilities.skills === null || !capabilities.card) {
    // Unreachable (includes malformed/SSRF-blocked URLs, which the caller
    // reclassifies into a 400 by checking for the "SSRF blocked:" prefix).
    // `authorized` is intentionally omitted — reachability and auth are
    // independent questions, and we have no evidence either way here.
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
      ? await resolveRemoteAgentToken(agent.auth, {
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
    // An id that cannot exist. A "task not found" JSON-RPC error proves the
    // peer authenticated us and ran our request; a 401 proves it rejected us;
    // anything else is a transport failure this call can't resolve either way.
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
      // Timeout, DNS failure, non-401 HTTP status, etc. The card fetch above
      // already proved reachability, so this must not be reported as
      // `reachable: false`, and an unresolved auth outcome must not be
      // reported as `authorized: false` either — leave it absent.
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
