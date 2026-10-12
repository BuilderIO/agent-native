import type { ActionEntry } from "../../agent/production-agent.js";

/**
 * The agent loop a request runs on: interactive chat (production or dev), an
 * A2A task, or an MCP `ask_app` call.
 */
export type AgentChatRequestSurface = "chat" | "a2a" | "mcp";

export interface AgentChatAdditionalActionsDetails {
  surface: AgentChatRequestSurface;
  /** The H3 event. Absent for `mcp`, which runs outside a chat handler. */
  event?: any;
  ownerEmail: string;
  orgId: string | null;
}

export type ResolveAgentChatAdditionalActions = (
  details: AgentChatAdditionalActionsDetails,
) => Record<string, ActionEntry> | Promise<Record<string, ActionEntry>>;

const reportedCollisions = new Set<string>();

/**
 * Runs the app's `resolveAdditionalActions` for one request and returns the
 * entries whose names `reserved` does not hold. A template, framework, or MCP
 * action name is never given to an app-supplied implementation, so an
 * allowlist or approval granted to that name can't be redirected; each
 * colliding name is reported once per process.
 */
export async function resolveAppAdditionalActions(
  resolver: ResolveAgentChatAdditionalActions | undefined,
  details: {
    surface: AgentChatRequestSurface;
    event?: any;
    ownerEmail: string | null | undefined;
    orgId: string | null | undefined;
  },
  reserved: Record<string, ActionEntry>,
): Promise<Record<string, ActionEntry>> {
  const { ownerEmail } = details;
  if (!resolver || !ownerEmail) return {};
  const entries = await resolver({
    surface: details.surface,
    event: details.event,
    ownerEmail,
    orgId: details.orgId ?? null,
  });
  const added: Record<string, ActionEntry> = {};
  for (const [name, entry] of Object.entries(entries)) {
    if (!Object.hasOwn(reserved, name)) {
      added[name] = entry;
      continue;
    }
    if (reportedCollisions.has(name)) continue;
    reportedCollisions.add(name);
    console.warn(
      `[agent-chat] resolveAdditionalActions returned "${name}", which is a registered action name; ignoring the app entry.`,
    );
  }
  return added;
}
