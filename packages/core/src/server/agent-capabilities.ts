import { canonicalA2AAudience } from "../a2a/audience.js";
import { A2AClient, A2ANoJsonRpcInterfaceError } from "../a2a/client.js";
import { resolveRemoteAgentToken } from "../a2a/remote-agent-auth.js";
import type { AgentCard, AgentSkill } from "../a2a/types.js";
import { type DiscoveredAgent } from "./agent-discovery.js";
import { getRequestOrgId, getRequestUserEmail } from "./request-context.js";

export const MAX_APPS = 30;
const MAX_SKILLS_IN_SUMMARY = 8;
const MAX_SKILLS_IN_DETAIL = 60;
const MAX_DESCRIPTION_CHARS = 240;
const CARD_TIMEOUT_MS = 6_000;
const CARD_CONCURRENCY = 8;
const CARD_CACHE_TTL_MS = 30_000;
const CARD_CACHE_ERROR_TTL_MS = 5_000;

interface CardCacheEntry {
  expiresAt: number;
  value: PeerCapabilities;
}

const cardCache = new Map<string, CardCacheEntry>();
const cardsInFlight = new Map<string, Promise<PeerCapabilities>>();

function cardCacheKey(agent: DiscoveredAgent, authenticate = true): string {
  return [
    getRequestUserEmail() ?? "",
    getRequestOrgId() ?? "",
    agent.url,
    agent.cardUrl ?? "",
    agent.auth?.type ?? "",
    agent.auth?.type === "bearer"
      ? agent.auth.credentialRef
      : (agent.auth?.clientSecretRef ?? ""),
    agent.kind?.provider ?? "",
    agent.kind?.provider === "anthropic-managed-agents"
      ? agent.kind.agentId
      : "",
    agent.kind?.provider === "anthropic-managed-agents"
      ? agent.kind.environmentId
      : "",
    agent.kind?.provider === "anthropic-managed-agents"
      ? agent.kind.credentialRef
      : "",
    authenticate ? "authenticated" : "anonymous",
  ].join("\u0000");
}

/** @internal — reset between tests. */
export function _resetCapabilityCacheForTests(): void {
  cardCache.clear();
  cardsInFlight.clear();
}

export interface PeerCapabilities {
  agent: DiscoveredAgent;
  skills: AgentSkill[] | null;
  cardDescription?: string;
  error?: string;
  card?: AgentCard;
  cardStatus?: "reachable" | "auth-rejected" | "no-json-rpc";
}

function truncate(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

function isReadOnlySkill(skill: AgentSkill): boolean {
  return (
    skill.readOnly === true ||
    (skill.readOnly === undefined && skill.publicAgent?.readOnly === true)
  );
}

export async function loadCapabilities(
  agent: DiscoveredAgent,
  options?: { authenticate?: boolean },
): Promise<PeerCapabilities> {
  const authenticate = options?.authenticate !== false;
  const key = cardCacheKey(agent, authenticate);
  const cached = cardCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const inFlight = cardsInFlight.get(key);
  if (inFlight) return inFlight;

  const pending = fetchCapabilities(agent, authenticate)
    .then((value) => {
      cardCache.set(key, {
        value,
        expiresAt:
          Date.now() +
          (value.skills === null ? CARD_CACHE_ERROR_TTL_MS : CARD_CACHE_TTL_MS),
      });
      return value;
    })
    // Always release the slot: a retained rejected promise would serve the
    // same failure to every later caller instead of letting them retry.
    .finally(() => cardsInFlight.delete(key));
  cardsInFlight.set(key, pending);
  return pending;
}

async function fetchCapabilities(
  agent: DiscoveredAgent,
  authenticate: boolean,
): Promise<PeerCapabilities> {
  if (agent.kind?.provider === "anthropic-managed-agents") {
    return {
      agent,
      skills: [],
      cardDescription:
        "Anthropic Managed Agent; send a natural-language message through the native adapter.",
    };
  }
  try {
    let token: string | undefined;
    if (authenticate && agent.auth) {
      token = await resolveRemoteAgentToken(agent.auth, {
        userEmail: getRequestUserEmail(),
        orgId: getRequestOrgId(),
      });
    } else if (authenticate) {
      try {
        const { signA2AToken } = await import("../a2a/client.js");
        const email = getRequestUserEmail();
        if (email) {
          token = await signA2AToken(email, undefined, undefined, {
            preferGlobalSecret: true,
            audience: canonicalA2AAudience(agent.url),
          });
        }
      } catch {
        // coercion-ok: unsigned internal discovery is an explicit anonymous-card fallback.
        // No signable identity (no secret, no session) — fall back to the
        // anonymous card rather than failing discovery outright.
      }
    }
    const cardUrl = agent.cardUrl;
    const client = new A2AClient(agent.url, token, {
      ...(cardUrl ? { cardUrl } : {}),
      requestTimeoutMs: CARD_TIMEOUT_MS,
    });
    const card = await client.getAgentCard({
      timeoutMs: CARD_TIMEOUT_MS,
      ...(cardUrl ? { cardUrl } : {}),
      ...(token ? { token } : {}),
    });
    let cardStatus: PeerCapabilities["cardStatus"] = "reachable";
    try {
      await client.resolveEndpointUrl(CARD_TIMEOUT_MS);
    } catch (error) {
      if (error instanceof A2ANoJsonRpcInterfaceError) {
        cardStatus = "no-json-rpc";
      } else {
        throw error;
      }
    }
    return {
      agent,
      skills: Array.isArray(card.skills) ? card.skills : [],
      cardDescription:
        typeof card.description === "string" ? card.description : undefined,
      card,
      cardStatus,
    };
  } catch (error) {
    const statusCode =
      typeof (error as { statusCode?: unknown })?.statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : undefined;
    return {
      agent,
      skills: null,
      error: error instanceof Error ? error.message : String(error),
      ...(statusCode === 401 || statusCode === 403
        ? { cardStatus: "auth-rejected" as const }
        : {}),
    };
  }
}

export async function loadAllCapabilities(
  agents: DiscoveredAgent[],
): Promise<PeerCapabilities[]> {
  const results: PeerCapabilities[] = [];
  for (let i = 0; i < agents.length; i += CARD_CONCURRENCY) {
    results.push(
      ...(await Promise.all(
        agents
          .slice(i, i + CARD_CONCURRENCY)
          .map((agent) => loadCapabilities(agent)),
      )),
    );
  }
  return results;
}

export function purposeOf(peer: PeerCapabilities): string {
  const manifest = peer.agent.description?.trim();
  if (manifest) return truncate(manifest, MAX_DESCRIPTION_CHARS);
  const card = peer.cardDescription?.trim();
  return card
    ? truncate(card, MAX_DESCRIPTION_CHARS)
    : "(no description published)";
}

export function formatCapabilitySummary(
  peers: PeerCapabilities[],
  truncated: number,
  detailHint: (appId: string) => string,
): string {
  const lines = peers.map((peer) => {
    const header = `### ${peer.agent.name} (${peer.agent.id})\n${purposeOf(peer)}`;
    if (peer.skills === null) {
      return `${header}\nCapabilities: could not read agent card (${truncate(peer.error ?? "unreachable", 120)}). Delegate with a natural-language message instead of a direct action.`;
    }
    if (peer.skills.length === 0) {
      return `${header}\nCapabilities: exposes no directly callable actions. Delegate with a natural-language message via call-agent.`;
    }
    const shown = peer.skills.slice(0, MAX_SKILLS_IN_SUMMARY);
    const rest = peer.skills.length - shown.length;
    const readOnly = shown.filter(isReadOnlySkill).map((skill) => skill.id);
    const messageOnly = shown
      .filter((skill) => !isReadOnlySkill(skill))
      .map((skill) => skill.id);
    const capabilityLines = [
      readOnly.length
        ? `Read-only actions (direct action + input): ${readOnly.join(", ")}`
        : "",
      messageOnly.length
        ? `Message-only capabilities (use a natural-language message): ${messageOnly.join(", ")}`
        : "",
    ].filter(Boolean);
    return `${header}\n${capabilityLines.join("\n")}${
      rest > 0 ? `\n(+${rest} more — ${detailHint(peer.agent.id)})` : ""
    }`;
  });

  return [
    `${peers.length} other app${peers.length === 1 ? "" : "s"} reachable from this one over A2A.`,
    truncated > 0
      ? `(${truncated} additional app${truncated === 1 ? "" : "s"} not shown.)`
      : "",
    "",
    lines.join("\n\n"),
    "",
    "Delegate with call-agent using a natural-language message by default. The receiving app owns interpretation and its local tools. Use action + input only for an exact bounded read with a fully known schema, never as a workaround for failed delegation. Prefer the app that owns the data over rebuilding its capability here.",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatSkillInput(skill: AgentSkill): string | undefined {
  const schema = skill.inputSchema as
    | {
        properties?: Record<string, { type?: unknown }>;
        required?: unknown;
      }
    | undefined;
  const properties = schema?.properties;
  if (!properties || typeof properties !== "object") return undefined;
  const names = Object.keys(properties);
  if (names.length === 0) return " — input: {} (no fields)";

  const required = new Set(
    Array.isArray(schema?.required)
      ? schema.required.filter(
          (name): name is string => typeof name === "string",
        )
      : [],
  );
  const fields = names.map((name) => {
    const type = properties[name]?.type;
    const rendered = typeof type === "string" ? type : "any";
    return `${name}${required.has(name) ? "*" : "?"}: ${rendered}`;
  });
  return ` — input: { ${fields.join(", ")} } (* = required)`;
}

export function formatCapabilityDetail(
  peer: PeerCapabilities,
  callHint: (appId: string) => string,
): string {
  const header = `## ${peer.agent.name} (${peer.agent.id})\n${purposeOf(peer)}\nURL: ${peer.agent.url}`;

  if (peer.skills === null) {
    return `${header}\n\nIts agent card could not be read (${truncate(peer.error ?? "unreachable", 200)}), so its callable actions are unknown. It may still answer a natural-language call-agent message.`;
  }
  if (peer.skills.length === 0) {
    return `${header}\n\nIt exposes no directly callable actions. Delegate with a natural-language call-agent message.`;
  }

  const shown = peer.skills.slice(0, MAX_SKILLS_IN_DETAIL);
  const rest = peer.skills.length - shown.length;
  const lines = shown.map((skill) => {
    const summary = skill.description
      ? truncate(skill.description, MAX_DESCRIPTION_CHARS)
      : skill.name || "(no description)";
    const readOnly = isReadOnlySkill(skill);
    const classification = readOnly
      ? ""
      : skill.readOnly === false || skill.publicAgent?.readOnly === false
        ? " (mutating)"
        : " (message only; direct reads unavailable)";
    return `- ${skill.id}${classification}: ${summary}${
      formatSkillInput(skill) ?? ""
    }`;
  });

  return [
    header,
    "",
    "Callable actions:",
    lines.join("\n"),
    rest > 0 ? `(+${rest} more not shown.)` : "",
    "",
    callHint(peer.agent.id),
  ]
    .filter(Boolean)
    .join("\n");
}
