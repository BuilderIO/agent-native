import { A2AClient } from "../a2a/client.js";
import type { AgentSkill } from "../a2a/types.js";
import { type DiscoveredAgent } from "./agent-discovery.js";

/** Matches the `<available-apps>` prompt block so both surfaces agree. */
export const MAX_APPS = 30;
const MAX_SKILLS_IN_SUMMARY = 8;
const MAX_SKILLS_IN_DETAIL = 60;
const MAX_DESCRIPTION_CHARS = 240;
const CARD_TIMEOUT_MS = 6_000;
const CARD_CONCURRENCY = 8;

export interface PeerCapabilities {
  agent: DiscoveredAgent;
  /** null distinguishes an unreachable card from a peer that exposes nothing. */
  skills: AgentSkill[] | null;
  cardDescription?: string;
  error?: string;
}

function truncate(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

export async function loadCapabilities(
  agent: DiscoveredAgent,
): Promise<PeerCapabilities> {
  try {
    const card = await new A2AClient(agent.url).getAgentCard({
      timeoutMs: CARD_TIMEOUT_MS,
    });
    return {
      agent,
      skills: Array.isArray(card.skills) ? card.skills : [],
      cardDescription:
        typeof card.description === "string" ? card.description : undefined,
    };
  } catch (error) {
    return {
      agent,
      skills: null,
      error: error instanceof Error ? error.message : String(error),
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
        agents.slice(i, i + CARD_CONCURRENCY).map(loadCapabilities),
      )),
    );
  }
  return results;
}

export function purposeOf(peer: PeerCapabilities): string {
  // The manifest description comes from the app's own package.json and is
  // authored; the card description is a generic template for auto-mounted
  // apps, so it is only a fallback.
  const manifest = peer.agent.description?.trim();
  if (manifest) return truncate(manifest, MAX_DESCRIPTION_CHARS);
  const card = peer.cardDescription?.trim();
  return card
    ? truncate(card, MAX_DESCRIPTION_CHARS)
    : "(no description published)";
}

/**
 * `detailHint` differs per surface: the agent tool tells the model to call
 * itself again with an app id, the CLI tells the reader to pass `--app`.
 */
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
    return `${header}\nCallable actions: ${shown.map((skill) => skill.id).join(", ")}${
      rest > 0 ? ` (+${rest} more — ${detailHint(peer.agent.id)})` : ""
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
    "Delegate with call-agent: pass action + input for a listed action, or message for open-ended work. Prefer the app that owns the data over rebuilding its capability here.",
  ]
    .filter(Boolean)
    .join("\n");
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
  const lines = shown.map(
    (skill) =>
      `- ${skill.id}${skill.readOnly ? "" : " (mutating)"}: ${
        skill.description
          ? truncate(skill.description, MAX_DESCRIPTION_CHARS)
          : skill.name || "(no description)"
      }`,
  );

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
