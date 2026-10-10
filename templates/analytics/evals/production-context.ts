import type {
  EvalProductionContext,
  EvalProductionIdentity,
} from "@agent-native/core/eval";
import type {
  AgentRunOutput,
  EvalProductionChatPath,
} from "@agent-native/core/eval";
import {
  actionsToEngineTools,
  attachToolSearch,
  buildFrameworkPrompts,
  generateActionsPrompt,
  loadActionsFromStaticRegistry,
  runAgentLoop,
  TOOL_SEARCH_ACTION_NAME,
  type ActionEntry,
  type AgentChatEvent,
  type AgentLoopFinalResponseGuard,
} from "@agent-native/core/server";

import actionsRegistry from "../.generated/actions-registry.js";
import { retrieveAnalyticsPromptReferences } from "../server/lib/analytics-agent-context.js";
import {
  INITIAL_TOOL_NAMES,
  analyticsExtraContext,
  realDataFinalGuard,
} from "../server/plugins/agent-chat.js";

const REQUIRED_ANALYTICS_QUERY_ACTIONS = [
  "find-data",
  "query-dbt-semantic-metric",
  "bigquery",
  "search-bigquery-schema",
] as const;

function toMessages(
  input: Parameters<EvalProductionChatPath["run"]>[0]["input"],
): Parameters<typeof runAgentLoop>[0]["messages"] {
  const messages: Parameters<typeof runAgentLoop>[0]["messages"] = [];
  for (const turn of input.history ?? []) {
    messages.push({
      role: turn.role,
      content: [{ type: "text", text: turn.text }],
    });
  }
  messages.push({
    role: "user",
    content: [{ type: "text", text: input.prompt }],
  });
  return messages;
}

function appendReferences(
  systemPrompt: string,
  candidates: Awaited<
    ReturnType<typeof retrieveAnalyticsPromptReferences>
  >["jevPromptCandidates"],
): string {
  if (candidates.length === 0) return systemPrompt;
  const references = candidates
    .map(
      (candidate) =>
        `### ${candidate.name}\n${candidate.description}\n${candidate.content}`,
    )
    .join("\n\n");
  return `${systemPrompt}\n\n<resource scope="analytics-catalog">\n${references}\n</resource>`;
}

export function filterAnalyticsEvalActions(
  registry: Record<string, ActionEntry>,
  actionAllowlist: readonly string[],
): Record<string, ActionEntry> {
  const unknown = actionAllowlist.filter((name) => !registry[name]);
  if (unknown.length > 0) {
    throw new Error(
      `Analytics eval action allowlist contains unknown actions: ${unknown.join(", ")}.`,
    );
  }

  const allowed = new Set(actionAllowlist);
  const actions = Object.fromEntries(
    Object.entries(registry).filter(
      ([name]) => allowed.has(name) && name !== TOOL_SEARCH_ACTION_NAME,
    ),
  );
  if (allowed.has(TOOL_SEARCH_ACTION_NAME)) attachToolSearch(actions);
  return actions;
}

function buildAnalyticsSystemPrompt(
  actions: Record<string, ActionEntry>,
  initialToolNames: string[],
): string {
  const frameworkPrompt = buildFrameworkPrompts(undefined, {
    extensions: true,
  }).PROD_FRAMEWORK_PROMPT_COMPACT;
  return [
    frameworkPrompt,
    generateActionsPrompt(actions, "tool", initialToolNames),
    analyticsExtraContext(),
    "This eval uses the production Analytics read-only action surface. Do not create, edit, send, publish, or persist app data.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function runAnalyticsProductionPath(args: {
  input: Parameters<EvalProductionChatPath["run"]>[0]["input"];
  identity: EvalProductionIdentity;
  engine: Parameters<typeof runAgentLoop>[0]["engine"];
  model: string;
  signal: AbortSignal;
  onUsage: Parameters<EvalProductionChatPath["run"]>[0]["onUsage"];
  actions: ReturnType<typeof loadActionsFromStaticRegistry>;
  initialToolNames: string[];
  systemPrompt: string;
}): Promise<Awaited<ReturnType<EvalProductionChatPath["run"]>>> {
  const references = await retrieveAnalyticsPromptReferences({
    request: args.input.prompt,
    email: args.identity.ownerEmail,
    orgId: args.identity.orgId,
    deadlineAt: Date.now() + 1_300,
  });
  const runId = `eval:${crypto.randomUUID()}`;
  const prompt = appendReferences(
    args.systemPrompt,
    references.jevPromptCandidates,
  );
  const availableTools = actionsToEngineTools(args.actions);
  const initialNames = new Set(args.initialToolNames);
  const tools = availableTools.filter((tool) => initialNames.has(tool.name));
  const availableActionNames = Object.keys(args.actions);
  const readOnlyActionNames = availableActionNames.filter(
    (name) => args.actions[name]?.readOnly === true,
  );
  const calls: Array<{
    name: string;
    input: unknown;
    startedAtEventIndex: number;
    completedAtEventIndex?: number;
    completed?: boolean;
    completedSideEffect?: boolean;
    isError?: boolean;
    result?: string;
    id?: string;
  }> = [];
  let text = "";
  let error: string | undefined;
  let eventIndex = 0;
  let guardApplied = false;
  let usage: Awaited<ReturnType<typeof runAgentLoop>> | undefined;
  const originalGuard = realDataFinalGuard as AgentLoopFinalResponseGuard;
  const finalResponseGuard: AgentLoopFinalResponseGuard = async (context) => {
    guardApplied = true;
    return originalGuard(context);
  };
  const send = (event: AgentChatEvent) => {
    const currentEventIndex = eventIndex++;
    if (event.type === "text") {
      text += event.text;
    } else if (event.type === "tool_start") {
      calls.push({
        id: event.id,
        name: event.tool,
        input: event.input,
        startedAtEventIndex: currentEventIndex,
      });
    } else if (event.type === "tool_done") {
      const call = event.id
        ? calls.find((entry) => entry.id === event.id)
        : calls.find((entry) => entry.name === event.tool && !entry.completed);
      if (call) {
        call.completed = true;
        call.completedAtEventIndex = currentEventIndex;
        call.completedSideEffect = event.completedSideEffect;
        call.isError = event.isError === true;
        call.result = event.result;
      }
    } else if (event.type === "error") {
      error = event.error;
    }
  };
  const receipt = {
    productionAgentLoopInvoked: false,
    requestPreparationInvoked: true,
    systemPromptBuilt: Boolean(prompt.trim()),
    finalResponseGuardInstalled: typeof realDataFinalGuard === "function",
    finalResponseGuardApplied: false,
    usageCaptured: false,
    prefetchStatus: references.prefetchStatus,
    ownerEmail: args.identity.ownerEmail,
    orgId: args.identity.orgId,
    initialToolNames: args.initialToolNames,
    availableActionNames,
    readOnlyActionNames,
  };
  if (
    references.prefetchStatus !== "ok" &&
    references.prefetchStatus !== "empty"
  ) {
    return {
      output: {
        text: "",
        toolCalls: [],
        ok: false,
        error: `Analytics request preparation ${references.prefetchStatus}.`,
        runId,
        durationMs: 0,
      },
      receipt,
    };
  }

  const started = Date.now();
  let ok = true;
  try {
    receipt.productionAgentLoopInvoked = true;
    usage = await runAgentLoop({
      engine: args.engine,
      model: args.model,
      systemPrompt: prompt,
      tools,
      availableTools,
      messages: toMessages(args.input),
      actions: args.actions,
      send,
      signal: args.signal,
      onUsage: args.onUsage,
      ownerEmail: args.identity.ownerEmail,
      orgId: args.identity.orgId,
      appId: "analytics",
      actionCaller: "tool",
      finalResponseGuard,
      finalResponseGuardRequestText: args.input.prompt,
      runId,
    });
  } catch (cause) {
    ok = false;
    error = cause instanceof Error ? cause.message : String(cause);
  }
  receipt.finalResponseGuardApplied = guardApplied;
  receipt.usageCaptured = Boolean(usage);
  const output: AgentRunOutput = {
    text,
    toolCalls: calls.map((call) => call.name),
    toolCallDetails: calls.map(({ id: _id, ...call }) => call),
    ok: ok && !error && !args.signal.aborted,
    ...(error ? { error } : {}),
    runId,
    durationMs: Date.now() - started,
    ...(usage ? { usage } : {}),
  };
  return { output, receipt };
}

/** Reuses the production prompt, request prefetch, read-only actions, guard, and agent loop. */
export function resolveProductionEvalContext(
  identity: EvalProductionIdentity,
): EvalProductionContext {
  const ownerEmail = identity.ownerEmail.trim();
  const orgId = identity.orgId.trim();
  if (!ownerEmail || !orgId) {
    throw new Error(
      "Analytics evals require a non-empty owner email and organization id.",
    );
  }

  const actions = Object.fromEntries(
    Object.entries(loadActionsFromStaticRegistry(actionsRegistry)).filter(
      ([, action]) =>
        action.readOnly === true &&
        action.agentTool !== false &&
        action.uiOnly !== true,
    ),
  );
  for (const actionName of REQUIRED_ANALYTICS_QUERY_ACTIONS) {
    if (!actions[actionName]) {
      throw new Error(
        `Analytics production eval action registry is missing read-only action "${actionName}".`,
      );
    }
  }
  attachToolSearch(actions);

  const initialToolNames = [
    ...new Set([...INITIAL_TOOL_NAMES, TOOL_SEARCH_ACTION_NAME]),
  ].filter((name) => Boolean(actions[name]));
  const systemPrompt = buildAnalyticsSystemPrompt(actions, initialToolNames);

  const productionChatPath: EvalProductionChatPath = {
    run: (args) => {
      const evalActions = filterAnalyticsEvalActions(
        actions,
        args.actionAllowlist,
      );
      const evalInitialToolNames = [
        ...new Set([...INITIAL_TOOL_NAMES, TOOL_SEARCH_ACTION_NAME]),
      ].filter((name) => Boolean(evalActions[name]));
      return runAnalyticsProductionPath({
        input: args.input,
        identity: args.identity,
        engine: args.engine,
        model: args.model,
        signal: args.signal,
        onUsage: args.onUsage,
        actions: evalActions,
        initialToolNames: evalInitialToolNames,
        systemPrompt: buildAnalyticsSystemPrompt(
          evalActions,
          evalInitialToolNames,
        ),
      });
    },
  };

  return {
    actions,
    systemPrompt,
    finalResponseGuard: realDataFinalGuard,
    ownerEmail,
    orgId,
    appId: "analytics",
    initialToolNames,
    productionChatPath,
  };
}
