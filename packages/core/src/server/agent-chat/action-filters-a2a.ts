import { getHeader } from "h3";

import {
  appendA2AArtifactLinks,
  type A2AArtifactResponseOptions,
  type A2AToolResultSummary,
} from "../../a2a/artifact-response.js";
import { collectFinalResponseTextFromAgentEvents } from "../../a2a/response-text.js";
import { resolveMainChatMaxOutputTokens } from "../../agent/engine/output-tokens.js";
import type { EngineTool } from "../../agent/engine/types.js";
import {
  filterInitialEngineTools,
  resolveAgentRequestReasoningEffort,
  type ActionEntry,
} from "../../agent/production-agent.js";
import { runAgentLoopDirectWithSoftTimeout } from "../../agent/run-loop-with-resume.js";
import type { AgentChatEvent } from "../../agent/types.js";
import { withConfiguredAppBasePath } from "../app-base-path.js";
import type { AgentChatPluginOptions } from "./plugin-options.js";

// ---------------------------------------------------------------------------
// Action-visibility filters (read-only / agent-exposed / public-agent-safe)
// and the A2A (agent-to-agent) final-response assembly + delegated-run
// helpers that share those filters.
// ---------------------------------------------------------------------------

export function filterReadOnlyActions(
  actions: Record<string, ActionEntry>,
): Record<string, ActionEntry> {
  return Object.fromEntries(
    Object.entries(actions).filter(([, entry]) => entry.readOnly === true),
  );
}

/** Drop actions that opted out of agent exposure via `agentTool: false`. They
 *  remain callable from the frontend / HTTP (mounted separately from this
 *  agent tool surface — see `httpActions`) but never appear in any agent tool
 *  list (in-app assistant, MCP, A2A, job/trigger runners) or actions prompt.
 *  Default-allow: only an explicit `false` is excluded. */
export function filterAgentTools(
  actions: Record<string, ActionEntry>,
): Record<string, ActionEntry> {
  return Object.fromEntries(
    Object.entries(actions).filter(([, entry]) => entry.agentTool !== false),
  );
}

export function filterPublicAgentActions(
  actions: Record<string, ActionEntry>,
): Record<string, ActionEntry> {
  return Object.fromEntries(
    Object.entries(actions).filter(([, entry]) => {
      const config = entry.publicAgent;
      return (
        config?.expose === true &&
        config.readOnly === true &&
        config.requiresAuth !== true &&
        config.isConsequential !== true
      );
    }),
  );
}

export function buildPublicAgentA2ASkills(
  actions: Record<string, ActionEntry>,
): Array<{
  id: string;
  name: string;
  description: string;
  publicAgent: ActionEntry["publicAgent"];
}> {
  return Object.entries(filterPublicAgentActions(actions)).map(
    ([name, entry]) => ({
      id: name,
      name,
      description: entry.tool.description,
      publicAgent: entry.publicAgent,
    }),
  );
}

export function resolveArtifactBaseUrl(
  event: any | undefined,
): string | undefined {
  const fromEnv =
    process.env.APP_URL ||
    process.env.URL ||
    process.env.DEPLOY_URL ||
    process.env.BETTER_AUTH_URL;
  if (fromEnv) return withConfiguredAppBasePath(String(fromEnv));

  try {
    const proto = getHeader(event, "x-forwarded-proto") || "https";
    const host = getHeader(event, "host");
    if (host) return withConfiguredAppBasePath(`${proto}://${host}`);
  } catch {}

  return undefined;
}

export function assembleA2AFinalResponse(
  events: readonly AgentChatEvent[],
  toolResults: readonly A2AToolResultSummary[],
  options: A2AArtifactResponseOptions & { event?: any } = {},
): { responseText: string; finalText: string } {
  const terminalError = getA2ATerminalErrorEvent(events);
  const responseText = collectFinalResponseTextFromAgentEvents(events, {
    fallbackToPreToolText: !terminalError,
  });
  const finalText = appendA2AArtifactLinks(responseText, [...toolResults], {
    baseUrl: options.baseUrl ?? resolveArtifactBaseUrl(options.event),
    includeReferencedArtifacts: true,
    includePersistedArtifactMarker: true,
  });
  if (terminalError && !finalText.trim()) {
    throw new Error(formatA2ATerminalError(terminalError));
  }
  return { responseText, finalText };
}

function getA2ATerminalErrorEvent(
  events: readonly AgentChatEvent[],
): Extract<AgentChatEvent, { type: "error" }> | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === "clear") continue;
    if (event.type === "done") return null;
    if (event.type === "error") return event;
    if (event.type === "auto_continue") {
      return {
        type: "error",
        error: `Agent stopped before finishing (${event.reason}).`,
        errorCode: event.reason,
        recoverable: true,
      };
    }
  }
  return null;
}

function formatA2ATerminalError(
  event: Extract<AgentChatEvent, { type: "error" }>,
): string {
  const parts = [
    event.error || "Agent failed before producing a final response.",
    event.errorCode ? `code: ${event.errorCode}` : "",
    event.details ? `details: ${event.details}` : "",
  ].filter(Boolean);
  return parts.join("\n");
}

type A2AAgentLoopRunner = typeof runAgentLoopDirectWithSoftTimeout;

function runDelegatedAgentLoop(
  runOptions: Parameters<A2AAgentLoopRunner>[0],
  pluginOptions: Pick<
    AgentChatPluginOptions,
    "finalResponseGuard" | "runSoftTimeoutMs"
  >,
  timeoutOptions: Parameters<A2AAgentLoopRunner>[2],
  runner: A2AAgentLoopRunner,
) {
  return runner(
    {
      ...runOptions,
      // Delegated runs resolve their own model and do not pass through the
      // interactive request handler's output-token setup. Use the same
      // model-aware headroom here so reasoning models (notably GPT-5.x) do
      // not spend the small internal default entirely on reasoning before
      // emitting a tool call or answer. Preserve explicit test/caller values.
      maxOutputTokens:
        runOptions.maxOutputTokens ??
        resolveMainChatMaxOutputTokens(runOptions.model),
      reasoningEffort:
        runOptions.reasoningEffort ??
        resolveAgentRequestReasoningEffort({ model: runOptions.model }),
      finalResponseGuard: pluginOptions.finalResponseGuard,
    },
    pluginOptions.runSoftTimeoutMs,
    timeoutOptions,
  );
}

/**
 * Run an A2A-delegated agent turn with the same final-response guard used by
 * the app's interactive chat surface.
 *
 * Keeping this in one helper prevents delegated calls from silently bypassing
 * template guarantees such as Analytics' requirement to query real data
 * before presenting metrics or exhaustive provider conclusions.
 */
export function runA2AAgentLoop(
  runOptions: Parameters<A2AAgentLoopRunner>[0],
  pluginOptions: Pick<
    AgentChatPluginOptions,
    "finalResponseGuard" | "runSoftTimeoutMs"
  >,
  timeoutOptions: Parameters<A2AAgentLoopRunner>[2],
  runner: A2AAgentLoopRunner = runAgentLoopDirectWithSoftTimeout,
) {
  return runDelegatedAgentLoop(
    runOptions,
    pluginOptions,
    timeoutOptions,
    runner,
  );
}

/**
 * Run the MCP-local ask_app turn with the same app-level response guard as
 * A2A. Keeping this seam shared prevents hosted MCP callers from bypassing
 * template guarantees when the request cannot use the self-A2A route.
 */
export function runMCPAgentLoop(
  runOptions: Parameters<A2AAgentLoopRunner>[0],
  pluginOptions: Pick<
    AgentChatPluginOptions,
    "finalResponseGuard" | "runSoftTimeoutMs"
  >,
  timeoutOptions: Parameters<A2AAgentLoopRunner>[2],
  runner: A2AAgentLoopRunner = runAgentLoopDirectWithSoftTimeout,
) {
  return runDelegatedAgentLoop(
    runOptions,
    pluginOptions,
    timeoutOptions,
    runner,
  );
}

/**
 * Keep delegated A2A turns on the same compact initial tool surface as
 * interactive chat. `tool-search` remains in the initial set, while the
 * complete registry is supplied separately so the run loop can load a matched
 * schema after a tool-search result.
 */
export function createA2AEngineToolSurface(
  availableTools: EngineTool[],
  initialToolNames?: string[],
): { tools: EngineTool[]; availableTools: EngineTool[] } {
  return {
    tools: filterInitialEngineTools(availableTools, initialToolNames),
    availableTools,
  };
}

export function resolveInitialToolNames(
  templateActions: Record<string, ActionEntry>,
  configured?: string[],
): string[] {
  return configured ?? Object.keys(templateActions);
}
