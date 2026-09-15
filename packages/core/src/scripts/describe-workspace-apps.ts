import type { ActionTool } from "../agent/types.js";
import {
  formatCapabilityDetail,
  formatCapabilitySummary,
  loadAllCapabilities,
  loadCapabilities,
  MAX_APPS,
} from "../server/agent-capabilities.js";
import { discoverAgents, findAgent } from "../server/agent-discovery.js";

export const tool: ActionTool = {
  description:
    "Describe what the OTHER apps in this workspace can do for this app, read live from each peer's published A2A agent card. Use this before building a capability locally, before telling the user what is or is not possible across apps, and whenever the user asks which app they should use for something. Ask the owning app's agent with a natural-language call-agent message by default; published action contracts are optional details for exact bounded reads, not a substitute for the specialist agent. Pass `app` for one peer's full capability list. This is generated from live deployments - never hand-maintain or cache a list of workspace apps in code, docs, or markdown.",
  parameters: {
    type: "object",
    properties: {
      app: {
        type: "string",
        description:
          "Optional app id or name. When set, returns that one peer's full capability list instead of a summary of every peer.",
      },
    },
  },
};

export async function run(
  args: Record<string, unknown>,
  _context?: unknown,
  selfAppId?: string,
): Promise<string> {
  const requested = String(args.app ?? "").trim();

  if (requested) {
    const agent = await findAgent(requested, selfAppId);
    if (!agent) {
      const available = (await discoverAgents(selfAppId))
        .map((peer) => peer.id)
        .join(", ");
      return `Error: no workspace app "${requested}". Available: ${available || "(none)"}`;
    }
    return formatCapabilityDetail(
      await loadCapabilities(agent),
      (appId) =>
        `Ask this specialist with call-agent: agent="${appId}", message="<objective>". Use action + input only for an exact bounded read with a fully known schema; use message for creates, updates, deletes, sends, saves, publishes, or any other side effect.`,
    );
  }

  const agents = await discoverAgents(selfAppId);
  if (agents.length === 0) {
    return "No other apps are reachable from this one. This app is running standalone, so build the capability here rather than delegating.";
  }

  const shown = agents.slice(0, MAX_APPS);
  return formatCapabilitySummary(
    await loadAllCapabilities(shown),
    agents.length - shown.length,
    (appId) => `call describe-workspace-apps with app="${appId}"`,
  );
}
