import type { ActionTool } from "../agent/types.js";
import {
  formatCapabilityDetail,
  formatCapabilitySummary,
  loadAllCapabilities,
  loadCapabilities,
  MAX_APPS,
} from "../server/agent-capabilities.js";
import {
  discoverAgents,
  discoverAgentsWithDirectoryStatus,
  findAgent,
} from "../server/agent-discovery.js";
import { selectWorkspaceAppCandidates } from "../server/workspace-app-selection.js";

export const tool: ActionTool = {
  description:
    "Describe what the OTHER apps in this workspace can do for this app, read live from each peer's published A2A agent card. Use only when the current request needs another app's data or capability but you cannot tell which peer owns it or whether a known peer can provide it, or when the user asks which app can do the job. Do not use it as a preflight for ordinary local work. Ask the owning app's agent with a natural-language call-agent message by default; published action contracts are optional details for exact bounded reads, not a substitute for the specialist agent. Pass `app` for one peer's full capability list. This is generated from live deployments - never hand-maintain or cache a list of workspace apps in code, docs, or markdown.",
  parameters: {
    type: "object",
    properties: {
      app: {
        type: "string",
        description:
          "Optional app id or name. When set, returns that one peer's full capability list instead of a summary of every peer.",
      },
      query: {
        type: "string",
        description:
          "Optional description of the capability you need. Searches and ranks all reachable peers before the result limit; refine a truncated list with a more specific query.",
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

  const discovery = await discoverAgentsWithDirectoryStatus(selfAppId);
  const agents = discovery.agents;
  if (agents.length === 0) {
    if (discovery.directory.status === "unavailable") {
      return `The organization app directory is unavailable (${discovery.directory.reason}). Workspace app availability could not be determined.`;
    }
    if (discovery.directory.status === "forbidden") {
      return "The organization app directory is unavailable (forbidden). Workspace app availability could not be determined.";
    }
    if (discovery.directory.status === "setup-required") {
      return `The organization app directory is not configured (${discovery.directory.reason}). This app is running standalone, so build the capability here rather than delegating.`;
    }
    return "No other apps are reachable from this one. This app is running standalone, so build the capability here rather than delegating.";
  }

  const query = String(args.query ?? "").trim();
  const selection = selectWorkspaceAppCandidates(agents, query, MAX_APPS);
  const shown = selection.agents;
  const summary = formatCapabilitySummary(
    await loadAllCapabilities(shown),
    0,
    (appId) => `call describe-workspace-apps with app="${appId}"`,
  );
  const list = selection.omittedCount
    ? `${summary}\n+${selection.omittedCount} more — search with describe-workspace-apps query="..."`
    : summary;
  const directoryStatus =
    discovery.directory.status === "unavailable"
      ? `Organization app directory status: unavailable (${discovery.directory.reason}). This list may be incomplete.`
      : discovery.directory.status === "forbidden"
        ? "Organization app directory status: forbidden. This list may be incomplete."
        : discovery.directory.status === "setup-required"
          ? `Organization app directory status: setup-required (${discovery.directory.reason}). This list may be incomplete.`
          : null;

  return directoryStatus ? `${directoryStatus}\n${list}` : list;
}
