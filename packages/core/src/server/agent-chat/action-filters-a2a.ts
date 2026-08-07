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
  type AgentLoopOutcome,
} from "../../agent/production-agent.js";
import { runAgentLoopDirectWithSoftTimeout } from "../../agent/run-loop-with-resume.js";
import { resolveRunSoftTimeoutMs } from "../../agent/run-manager.js";
import type { AgentChatEvent } from "../../agent/types.js";
import { isFrameworkGroupedAction } from "../../framework-tools.js";
import {
  isAuthenticatedReadAction,
  isAutoReadExcludedActionName,
} from "../../mcp/build-server.js";
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

/**
 * Input fields that unambiguously carry a program the receiver executes.
 *
 * Deliberately excludes `query`: across the templates that field is nearly
 * always natural-language search text (Brain's `search-everything`,
 * `search-knowledge`), and blocking it would break exactly the ask-don't-instruct
 * calls this rule exists to encourage.
 */
const RAW_QUERY_INPUT_FIELDS = new Set(["sql", "code", "script", "expression"]);

/**
 * True when an action takes a free-form query or program as input — raw SQL, a
 * code body, an arbitrary expression.
 *
 * Such an action must not be sibling-invocable over A2A. The app that owns the
 * data owns its schema, data dictionary, skills, and reference queries; a
 * calling app has none of that, so letting it pass SQL means every caller
 * reimplements the owner's schema knowledge badly and silently rots when the
 * owner's shape changes. Callers ask the owning app a question; the owner
 * forms the query. Set `publicAgent.allowRawQueryInput` to opt a specific
 * action out of this rule.
 */
export function hasRawQueryInput(entry: ActionEntry): boolean {
  const parameters = entry.tool?.parameters as
    | { properties?: Record<string, { type?: unknown }> }
    | undefined;
  const properties = parameters?.properties;
  if (!properties || typeof properties !== "object") return false;
  return Object.entries(properties).some(([field, schema]) => {
    const type = schema?.type;
    const acceptsString =
      type === "string" ||
      type === undefined ||
      (Array.isArray(type) && type.includes("string"));
    return RAW_QUERY_INPUT_FIELDS.has(field.toLowerCase()) && acceptsString;
  });
}

/**
 * Direct A2A action calls share the authenticated external-agent policy with
 * MCP, but remain stricter: only explicitly exposed, authenticated read-only
 * actions can skip the receiver's model loop, and never one that takes a raw
 * query the caller wrote.
 */
export function filterDirectA2AActions(
  actions: Record<string, ActionEntry>,
  options: Pick<AgentChatPluginOptions, "connectorCatalog" | "externalAgents">,
): Record<string, ActionEntry> {
  const catalog = new Set(options.connectorCatalog ?? []);
  const denied = new Set(options.externalAgents?.denyActions ?? []);
  const autoReads = options.externalAgents?.authenticatedReads === "auto";

  return Object.fromEntries(
    Object.entries(actions).filter(([name, entry]) => {
      const exposure = entry.publicAgent;
      const selected =
        catalog.has(name) ||
        (autoReads &&
          isAuthenticatedReadAction(entry) &&
          !isAutoReadExcludedActionName(name));
      const rawQueryAllowed =
        !hasRawQueryInput(entry) || exposure?.allowRawQueryInput === true;
      return (
        selected &&
        rawQueryAllowed &&
        !denied.has(name) &&
        entry.agentTool !== false &&
        entry.readOnly === true &&
        exposure?.expose === true &&
        exposure.readOnly === true &&
        exposure.requiresAuth === true &&
        (entry.needsApproval === undefined || entry.needsApproval === false) &&
        exposure.isConsequential !== true
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
  inputSchema?: Record<string, unknown>;
}> {
  return Object.entries(filterPublicAgentActions(actions)).map(
    ([name, entry]) => ({
      id: name,
      name,
      description: entry.tool.description,
      publicAgent: entry.publicAgent,
      ...(entry.tool.parameters
        ? {
            inputSchema: entry.tool.parameters as unknown as Record<
              string,
              unknown
            >,
          }
        : {}),
    }),
  );
}

/**
 * Skills for a caller with a verified A2A identity: exactly what
 * `filterDirectA2AActions` will execute. Kept separate from
 * `buildPublicAgentA2ASkills` because the public card may only name actions
 * with `requiresAuth !== true` while direct invocation requires
 * `requiresAuth === true` — advertising the public set alone tells siblings
 * an app has nothing callable when it does.
 */
export function buildAuthenticatedAgentA2ASkills(
  actions: Record<string, ActionEntry>,
  options: Pick<AgentChatPluginOptions, "connectorCatalog" | "externalAgents">,
): Array<{
  id: string;
  name: string;
  description: string;
  publicAgent: ActionEntry["publicAgent"];
  inputSchema?: Record<string, unknown>;
}> {
  return Object.entries(filterDirectA2AActions(actions, options)).map(
    ([name, entry]) => ({
      id: name,
      name,
      description: entry.tool.description,
      publicAgent: entry.publicAgent,
      // Every action in this set is read-only by construction. Omitting the
      // flag made discovery label all of them "(mutating)", which pushes a
      // caller away from invoking them and back into open-ended delegation.
      readOnly: true,
      // Naming an action without its parameters is what makes a caller invoke
      // it with `{}` and fail on a required field.
      ...(entry.tool.parameters
        ? {
            inputSchema: entry.tool.parameters as unknown as Record<
              string,
              unknown
            >,
          }
        : {}),
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
  options: A2AArtifactResponseOptions & {
    event?: any;
    outcome?: AgentLoopOutcome;
  } = {},
): { responseText: string; finalText: string } {
  const terminalError = options.outcome
    ? terminalErrorFromOutcome(options.outcome)
    : getA2ATerminalErrorEvent(events);
  const responseText = collectFinalResponseTextFromAgentEvents(events, {
    fallbackToPreToolText: !terminalError,
  });
  const finalText = appendA2AArtifactLinks(responseText, [...toolResults], {
    baseUrl: options.baseUrl ?? resolveArtifactBaseUrl(options.event),
    includeReferencedArtifacts: true,
    includePersistedArtifactMarker: true,
  });
  if (terminalError) {
    const partialResult = finalText.trim()
      ? `\n\nPartial verified results before the failure:\n${finalText.trim()}`
      : "";
    throw new Error(formatA2ATerminalError(terminalError) + partialResult);
  }
  if (!finalText.trim()) {
    throw new Error(
      "Agent completed without a response or verified artifact.\ncode: empty_agent_response",
    );
  }
  return { responseText, finalText };
}

function terminalErrorFromOutcome(
  outcome: AgentLoopOutcome,
): Extract<AgentChatEvent, { type: "error" }> | null {
  if (outcome.state === "completed") return null;
  if (outcome.state === "failed") {
    return {
      type: "error",
      error: outcome.message,
      errorCode: outcome.code,
      recoverable: outcome.retryable,
    };
  }
  if (outcome.state === "input_required") {
    return {
      type: "error",
      error: outcome.message,
      errorCode: outcome.code,
      recoverable: true,
    };
  }
  return {
    type: "error",
    error: outcome.message ?? "Agent run was canceled.",
    errorCode: "canceled",
    recoverable: false,
  };
}

function getA2ATerminalErrorEvent(
  events: readonly AgentChatEvent[],
): Extract<AgentChatEvent, { type: "error" }> | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === "clear") continue;
    if (event.type === "done") return null;
    if (event.type === "error") return event;
    if (event.type === "tripwire") {
      return {
        type: "error",
        error: event.reason || "Agent stopped at a delegated-run guardrail.",
        errorCode: event.processor ? `tripwire:${event.processor}` : "tripwire",
        recoverable: true,
      };
    }
    if (event.type === "loop_limit") {
      return {
        type: "error",
        error:
          "Agent stopped before finishing at the delegated-run step limit.",
        errorCode: "loop_limit",
        recoverable: true,
      };
    }
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

/**
 * Delegated turns should do specialist work with the receiver's own tools,
 * but must return a bounded caller-ready result. Interactive defaults allow
 * extremely deep work (400 iterations / 20M cumulative input tokens), which
 * made healthy Slides -> Analytics calls take 4-13 minutes and consume up to
 * millions of input tokens as tool results accumulated. These defaults leave
 * ample room for multi-source analysis while failing before a delegated turn
 * can silently become an unbounded research session.
 */
export const DEFAULT_DELEGATED_MAX_ITERATIONS = 80;
export const DEFAULT_DELEGATED_MAX_RUN_INPUT_TOKENS = 750_000;
export const DEFAULT_DELEGATED_MAX_TOOL_RESULT_CHARS = 20_000;

/**
 * A sentence naming the wall clock this delegated step actually gets, or "" when
 * there is no enforced budget (local dev returns 0 from the resolver).
 *
 * "I ran out of time before finishing this step" was 39% of all failed inbound
 * A2A tasks in one measured week, clustered at 35-46s against a 40s foreground
 * serverless wall. The callee was never told that wall exists: it is handed a
 * nominal 80 iterations and 750k tokens and plans accordingly, while production
 * iterations measure ~34s each — so a foreground chunk affords roughly one.
 *
 * The clock is already enforced correctly; a second, cruder cap on iterations
 * would only waste budget. What was missing is that the agent could not see it.
 * An agent that knows it has forty seconds scopes to forty seconds.
 */
function delegatedTimeBudgetNote(
  runSoftTimeoutMs: number | undefined,
  backgroundFunction: boolean,
): string {
  const softTimeoutMs = resolveRunSoftTimeoutMs(runSoftTimeoutMs, {
    useHostedDefault: true,
    backgroundFunction,
  });
  if (!Number.isFinite(softTimeoutMs) || softTimeoutMs <= 0) return "";
  const seconds = Math.max(1, Math.round(softTimeoutMs / 1000));
  return (
    `\n<delegated-time-budget>\n` +
    `This step is cut off after about ${seconds} seconds. Scope the work to fit it. ` +
    `Prefer one decisive action over exploring, and note that a single tool call plus a model ` +
    `response commonly takes tens of seconds — so plan on completing very few steps, not many. ` +
    `If the objective cannot be finished in that window, return the best grounded partial answer ` +
    `and say what is missing. Do not begin work you cannot finish, and do not treat this budget ` +
    `as a reason to skip verifying what you do report.\n` +
    `</delegated-time-budget>`
  );
}

export const DELEGATED_AGENT_EXECUTION_CONTRACT = `
<delegated-agent-contract>
This request was delegated by another app. You are the specialist owner of the work.
- Interpret the caller's natural-language objective using your own instructions, skills, data dictionary, credentials, and tools. Choose providers, schemas, queries, and joins here; never ask the caller to invent SQL or source-specific implementation details for you.
- Finish the objective autonomously in this delegated turn whenever a safe, reasonable default exists. Do not bounce the work back with UI-navigation requests, implementation questions, or intermediate status. Ask for input only when authorization, missing credentials, or a consequential user choice truly blocks progress.
- When evidence is incomplete, return the best grounded partial answer with explicit coverage gaps instead of refusing or asking the caller to choose your source, filter, dashboard, or workflow.
- Reach for your own registered actions first and by name. They are the same actions this app's interactive chat uses and are almost always the shortest path to the answer. Do not rediscover your own capabilities by exploring, and never use a shell, filesystem, or code-execution tool to do what one of your actions already does — that is the difference between answering in seconds and answering in minutes.
- Minimize round trips. Filter, join, aggregate, paginate, stage, and reduce large datasets inside your own tools rather than returning raw records or transcripts.
- Return a concise caller-ready result with the answer, source and coverage details, relevant counts or IDs, caveats/partial gaps, and exact artifact URLs. Do not return tool transcripts or large raw payloads.
</delegated-agent-contract>`;

export interface DelegatedAgentLoopTelemetry {
  runId: string;
  threadId: string | null;
  userId: string | null;
  delegation: {
    protocol: "a2a" | "mcp";
    callerApp?: string;
    taskId?: string;
    parentRunId?: string;
    parentTurnId?: string;
  };
}

interface DelegatedAgentLoopOptions {
  runner?: A2AAgentLoopRunner;
  telemetry?: DelegatedAgentLoopTelemetry;
}

async function runDelegatedAgentLoop(
  runOptions: Parameters<A2AAgentLoopRunner>[0],
  pluginOptions: Pick<
    AgentChatPluginOptions,
    "delegatedRunPolicy" | "finalResponseGuard" | "runSoftTimeoutMs"
  >,
  timeoutOptions: Parameters<A2AAgentLoopRunner>[2],
  options: DelegatedAgentLoopOptions,
) {
  const runner = options.runner ?? runAgentLoopDirectWithSoftTimeout;
  const policy = pluginOptions.delegatedRunPolicy;
  const configuredHardToolResultCap = runOptions.toolLimits?.hardMaxResultChars;
  const delegatedHardToolResultCap =
    policy?.maxToolResultChars ?? DEFAULT_DELEGATED_MAX_TOOL_RESULT_CHARS;
  const resolvedRunOptions = {
    ...runOptions,
    systemPrompt:
      runOptions.systemPrompt +
      DELEGATED_AGENT_EXECUTION_CONTRACT +
      delegatedTimeBudgetNote(
        pluginOptions.runSoftTimeoutMs,
        timeoutOptions?.backgroundFunction === true,
      ),
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
    maxIterations:
      runOptions.maxIterations ??
      policy?.maxIterations ??
      DEFAULT_DELEGATED_MAX_ITERATIONS,
    maxRunInputTokens:
      runOptions.maxRunInputTokens ??
      policy?.maxRunInputTokens ??
      DEFAULT_DELEGATED_MAX_RUN_INPUT_TOKENS,
    toolLimits: {
      ...(runOptions.toolLimits ?? {}),
      hardMaxResultChars:
        typeof configuredHardToolResultCap === "number"
          ? Math.min(configuredHardToolResultCap, delegatedHardToolResultCap)
          : delegatedHardToolResultCap,
    },
    finalResponseGuard: pluginOptions.finalResponseGuard,
  };
  const execute = (loopOptions = resolvedRunOptions) =>
    runner(loopOptions, pluginOptions.runSoftTimeoutMs, timeoutOptions);

  if (!options.telemetry) return execute();

  let instrumented = false;
  try {
    const { getObservabilityConfig, instrumentAgentLoop } =
      await import("../../observability/traces.js");
    const config = await getObservabilityConfig();
    if (config.enabled) {
      instrumented = true;
      return await instrumentAgentLoop({
        runAgentLoop: (loopOptions) =>
          execute(
            loopOptions as Parameters<A2AAgentLoopRunner>[0] &
              typeof resolvedRunOptions,
          ),
        loopOpts: resolvedRunOptions,
        runId: options.telemetry.runId,
        threadId: options.telemetry.threadId,
        userId: options.telemetry.userId,
        config,
        delegation: options.telemetry.delegation,
      });
    }
  } catch (error) {
    // Match interactive chat: setup failures fall through, but a failure from
    // inside an instrumented agent loop is the real run failure and rethrows.
    if (instrumented) throw error;
  }
  return execute();
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
    "delegatedRunPolicy" | "finalResponseGuard" | "runSoftTimeoutMs"
  >,
  timeoutOptions: Parameters<A2AAgentLoopRunner>[2],
  options: DelegatedAgentLoopOptions = {},
) {
  return runDelegatedAgentLoop(
    runOptions,
    pluginOptions,
    timeoutOptions,
    options,
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
    "delegatedRunPolicy" | "finalResponseGuard" | "runSoftTimeoutMs"
  >,
  timeoutOptions: Parameters<A2AAgentLoopRunner>[2],
  options: DelegatedAgentLoopOptions = {},
) {
  return runDelegatedAgentLoop(
    runOptions,
    pluginOptions,
    timeoutOptions,
    options,
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

/**
 * The first-request tool catalog: an explicit `initialToolNames` verbatim, or
 * the app's OWN actions by default.
 *
 * "Its own actions" excludes the framework kits. They arrive in this same
 * registry through `autoDiscoverActions` -> `mergeCoreSharingActions`, so the
 * plain `Object.keys` default promoted ~45 sharing/review/history/flag schemas
 * into every app's first request whether or not the app had those surfaces. They
 * remain in `availableTools` and are still found by `tool-search`; an app that
 * wants one on turn one names it in `initialToolNames`.
 */
export function resolveInitialToolNames(
  templateActions: Record<string, ActionEntry>,
  configured?: string[],
): string[] {
  if (configured) return configured;
  return Object.entries(templateActions)
    .filter(([, entry]) => !isFrameworkGroupedAction(entry))
    .map(([name]) => name);
}
