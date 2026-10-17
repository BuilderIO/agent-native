import {
  resolveEngine,
  getStoredModelForEngine,
  normalizeModelForEngine,
} from "../agent/engine/index.js";
import type {
  AgentEngine,
  EngineMessage,
  EngineTool,
} from "../agent/engine/types.js";
import type {
  ActionEntry,
  ActionCaller,
  AgentLoopFinalResponseGuard,
  AgentLoopUsage,
} from "../agent/production-agent.js";
import {
  actionsToEngineTools,
  runAgentLoop,
} from "../agent/production-agent.js";
import {
  attachToolSearch,
  TOOL_SEARCH_ACTION_NAME,
} from "../agent/tool-search.js";
import type { AgentChatEvent } from "../agent/types.js";
import { runWithRequestContext } from "../server/request-context.js";
import type {
  AgentRunOptions,
  AgentRunOutput,
  EvalProductionContext,
  EvalInput,
  EvalProductionPathRun,
  ScorerAnalyzeContext,
} from "./types.js";

const JUDGE_TIMEOUT_MS = 30_000;
const DEFAULT_AGENT_TIMEOUT_MS = 120_000;

export type RunAgentLoopFn = (opts: {
  engine: AgentEngine;
  model: string;
  systemPrompt: string;
  tools: EngineTool[];
  messages: EngineMessage[];
  actions: Record<string, ActionEntry>;
  send: (event: AgentChatEvent) => void;
  signal: AbortSignal;
  availableTools?: EngineTool[];
  onUsage?: (usage: AgentLoopUsage) => void;
  ownerEmail?: string;
  orgId?: string | null;
  appId?: string;
  actionCaller?: ActionCaller;
  finalResponseGuard?: AgentLoopFinalResponseGuard | null;
  finalResponseGuardRequestText?: string;
  runId?: string;
}) => Promise<AgentLoopUsage>;

interface AgentRunnerConfigBase {
  engine?: AgentEngine;
  model?: string;
  timeoutMs?: number;
  runLoop?: RunAgentLoopFn;
}

export type AgentRunnerConfig = AgentRunnerConfigBase &
  (
    | {
        productionContext: EvalProductionContext;
        actions?: Record<string, ActionEntry>;
        systemPrompt?: string;
      }
    | {
        productionContext?: undefined;
        actions: Record<string, ActionEntry>;
        systemPrompt?: string;
      }
  );

export interface AgentRunner {
  runAgent(
    input: EvalInput,
    options?: AgentRunOptions,
  ): Promise<AgentRunOutput>;
  analyzeContext(): ScorerAnalyzeContext;
  readonly engine: AgentEngine;
  readonly model: string;
}

const unscoreableProductionPathOutputs = new WeakSet<AgentRunOutput>();
const unscoreableProductionPathOutputBrand: unique symbol = Symbol(
  "unscoreable-production-path-output",
);
const productionContextRunnerMethodTokens = new WeakMap<Function, object>();
const productionContextRunnerEngineTokens = new WeakMap<object, object>();
const productionContextRunnerBrand: unique symbol = Symbol(
  "production-context-runner",
);

type UnscoreableProductionPathOutput = AgentRunOutput & {
  readonly [unscoreableProductionPathOutputBrand]?: string;
};

type ProductionContextBrandedRunner = AgentRunner & {
  readonly [productionContextRunnerBrand]?: object;
};

function preserveProductionContextMethod<
  T extends (...args: never[]) => unknown,
>(method: T, token: object): T {
  const wrapped = new Proxy(method, {
    get(target, property, receiver) {
      if (property === "bind") {
        return (...args: unknown[]) => {
          const bound = Reflect.apply(
            Function.prototype.bind,
            target,
            args,
          ) as T;
          return preserveProductionContextMethod(bound, token);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  productionContextRunnerMethodTokens.set(method, token);
  productionContextRunnerMethodTokens.set(wrapped, token);
  return wrapped as T;
}

function preserveProductionContextEngine(
  engine: AgentEngine,
  token: object,
): AgentEngine {
  const boundMethods = new WeakMap<Function, Function>();
  const wrapped = new Proxy(engine, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      const bound = boundMethods.get(value);
      if (bound) return bound;
      const boundMethod = value.bind(target);
      boundMethods.set(value, boundMethod);
      return boundMethod;
    },
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
    setPrototypeOf: () => false,
  });
  productionContextRunnerEngineTokens.set(wrapped, token);
  return wrapped;
}

export function isUnscoreableProductionPathOutput(
  output: AgentRunOutput,
): boolean {
  return (
    unscoreableProductionPathOutputs.has(output) ||
    typeof (output as UnscoreableProductionPathOutput)[
      unscoreableProductionPathOutputBrand
    ] === "string"
  );
}

export function getUnscoreableProductionPathOutputError(
  output: AgentRunOutput,
): string | undefined {
  return (
    (output as UnscoreableProductionPathOutput)[
      unscoreableProductionPathOutputBrand
    ] ??
    (unscoreableProductionPathOutputs.has(output) ? output.error : undefined)
  );
}

export function isProductionContextAgentRunner(runner: AgentRunner): boolean {
  const brandedRunner = runner as ProductionContextBrandedRunner;
  return (
    productionContextRunnerMethodTokens.has(runner.runAgent) ||
    productionContextRunnerMethodTokens.has(runner.analyzeContext) ||
    productionContextRunnerEngineTokens.has(runner.engine) ||
    brandedRunner[productionContextRunnerBrand] !== undefined
  );
}

export function hasOriginalProductionContextAgentRunnerMethods(
  runner: AgentRunner,
): boolean {
  const runToken = productionContextRunnerMethodTokens.get(runner.runAgent);
  const analyzeToken = productionContextRunnerMethodTokens.get(
    runner.analyzeContext,
  );
  const runnerToken = (runner as ProductionContextBrandedRunner)[
    productionContextRunnerBrand
  ];
  const engineToken = productionContextRunnerEngineTokens.get(runner.engine);
  return (
    runToken !== undefined &&
    runToken === analyzeToken &&
    (runnerToken === undefined || runnerToken === runToken) &&
    engineToken === runToken
  );
}

function toEngineMessages(input: EvalInput): EngineMessage[] {
  const messages: EngineMessage[] = [];
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

export async function createAgentRunner(
  config: AgentRunnerConfig,
): Promise<AgentRunner> {
  const productionContext = config.productionContext
    ? validateProductionContext(config.productionContext)
    : undefined;
  const actions = productionContext?.actions ?? config.actions;
  const systemPrompt =
    productionContext?.systemPrompt ?? config.systemPrompt ?? "";
  if (!actions) {
    throw new Error("Eval runner requires an action registry.");
  }
  const productionChatPath = productionContext?.productionChatPath;
  const runLoop =
    config.runLoop ??
    (productionContext ? undefined : (runAgentLoop as RunAgentLoopFn));
  if (!productionChatPath && !runLoop) {
    throw new Error(
      "Production eval requires an adapter that invokes the shared production agent loop.",
    );
  }
  if (productionChatPath && !productionContext?.orgId) {
    throw new Error(
      "Production chat evals require an explicit organization id.",
    );
  }
  if (
    productionChatPath &&
    (!productionContext?.finalResponseGuard ||
      Object.values(actions).some((action) => action.readOnly !== true))
  ) {
    throw new Error(
      "Production chat evals require the real final response guard and a read-only adapter action registry.",
    );
  }
  const resolveRuntimeModel = async () => {
    const engine =
      config.engine ??
      (await resolveEngine({ appId: productionContext?.appId }));
    const modelCandidate =
      config.model ??
      (await getStoredModelForEngine(engine, {
        appId: productionContext?.appId,
      })) ??
      engine.defaultModel;
    return { engine, model: normalizeModelForEngine(engine, modelCandidate) };
  };
  const runtimeModel = productionContext
    ? await runWithRequestContext(
        {
          userEmail: productionContext.ownerEmail,
          orgId: productionContext.orgId ?? undefined,
          isSyntheticTraffic: true,
        },
        resolveRuntimeModel,
      )
    : await resolveRuntimeModel();
  const { engine, model } = runtimeModel;
  const productionContextRunnerToken = productionContext ? {} : undefined;
  const runnerEngine = productionContextRunnerToken
    ? preserveProductionContextEngine(engine, productionContextRunnerToken)
    : engine;
  const timeoutMs = config.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;
  const initialToolNames = productionContext?.initialToolNames
    ? new Set(productionContext.initialToolNames)
    : undefined;
  const availableTools = actionsToEngineTools(actions);
  const tools = initialToolNames
    ? availableTools.filter((tool) => initialToolNames.has(tool.name))
    : availableTools;
  if (productionChatPath && tools.length === 0) {
    throw new Error(
      "Production eval context did not expose any initial agent tools.",
    );
  }

  async function runAgent(
    input: EvalInput,
    options: AgentRunOptions = {},
  ): Promise<AgentRunOutput> {
    const actionAllowlist = resolveActionAllowlist(
      actions!,
      options.actionAllowlist,
    );
    if (productionChatPath) {
      return runProductionChatPath({
        productionChatPath,
        productionContext: productionContext!,
        input,
        actionAllowlist,
        engine,
        model,
        timeoutMs,
      });
    }
    if (!runLoop) {
      throw new Error(
        "Production eval requires an adapter that invokes the shared production agent loop.",
      );
    }
    const runId = `eval:${crypto.randomUUID()}`;
    const messages = toEngineMessages(input);
    const runActions = options.actionAllowlist
      ? filterActionsForEval(actions!, actionAllowlist)
      : actions!;
    const runAvailableTools = options.actionAllowlist
      ? actionsToEngineTools(runActions)
      : availableTools;
    const runTools = initialToolNames
      ? runAvailableTools.filter((tool) => initialToolNames.has(tool.name))
      : runAvailableTools;

    let text = "";
    const toolCalls: string[] = [];
    const toolCallDetails: Array<{
      name: string;
      id?: string;
      input: unknown;
      startedAtEventIndex: number;
      completedAtEventIndex?: number;
      completed?: boolean;
      completedSideEffect?: boolean;
      isError?: boolean;
      result?: string;
    }> = [];
    let ok = true;
    let error: string | undefined;
    let eventIndex = 0;
    let finished = false;
    let timedOut = false;
    let partialUsage: AgentLoopUsage | undefined;

    const controller = new AbortController();
    const started = Date.now();
    const timeoutError = new Error(
      `Agent run timed out after ${timeoutMs} ms.`,
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort(timeoutError);
        reject(timeoutError);
      }, timeoutMs);
    });

    const send = (event: AgentChatEvent): void => {
      if (finished) return;
      const currentEventIndex = eventIndex++;
      switch (event.type) {
        case "text":
          text += event.text;
          break;
        case "tool_start":
          toolCalls.push(event.tool);
          toolCallDetails.push({
            name: event.tool,
            id: event.id,
            input: event.input,
            startedAtEventIndex: currentEventIndex,
          });
          break;
        case "tool_done": {
          const detail = event.id
            ? toolCallDetails.find((call) => call.id === event.id)
            : toolCallDetails.find(
                (call) => call.name === event.tool && !call.completed,
              );
          if (detail) {
            detail.completed = true;
            detail.completedAtEventIndex = currentEventIndex;
            detail.completedSideEffect = event.completedSideEffect;
            detail.isError = event.isError === true;
            detail.result = event.result;
          }
          break;
        }
        case "error":
          ok = false;
          error = event.error;
          break;
        default:
          break;
      }
    };

    let usage: AgentLoopUsage | undefined;
    try {
      const run = () =>
        runLoop({
          engine,
          model,
          systemPrompt,
          tools: runTools,
          ...(productionContext ? { availableTools: runAvailableTools } : {}),
          messages,
          actions: runActions,
          send,
          signal: controller.signal,
          onUsage: (next) => {
            if (finished) return;
            partialUsage = mergePartialUsage(partialUsage, next);
          },
          ...(productionContext
            ? {
                ownerEmail: productionContext.ownerEmail,
                orgId: productionContext.orgId,
                ...(productionContext.appId
                  ? { appId: productionContext.appId }
                  : {}),
                actionCaller: "tool" as const,
                finalResponseGuard: productionContext.finalResponseGuard,
                finalResponseGuardRequestText: input.prompt,
                runId,
              }
            : {}),
        });
      usage = await Promise.race([
        productionContext
          ? runWithRequestContext(
              {
                userEmail: productionContext.ownerEmail,
                ...(productionContext.orgId
                  ? { orgId: productionContext.orgId }
                  : { orgScope: "personal" as const }),
                isSyntheticTraffic: true,
              },
              run,
            )
          : run(),
        timeout,
      ]);
    } catch (err) {
      ok = false;
      error = timedOut
        ? timeoutError.message
        : err instanceof Error
          ? err.message
          : String(err);
      if (!controller.signal.aborted) controller.abort(err);
    } finally {
      finished = true;
      if (timer) clearTimeout(timer);
    }

    return {
      text,
      toolCalls,
      toolCallDetails: toolCallDetails.map(({ id: _id, ...detail }) => detail),
      ok,
      error,
      runId,
      durationMs: Date.now() - started,
      ...((usage ?? partialUsage) ? { usage: usage ?? partialUsage } : {}),
    };
  }

  function analyzeContext(): ScorerAnalyzeContext {
    return {
      engine: runnerEngine,
      model,
      async judge(opts): Promise<string> {
        const controller = new AbortController();
        const signal = opts.signal ?? controller.signal;
        const timer = opts.signal
          ? undefined
          : setTimeout(() => controller.abort(), JUDGE_TIMEOUT_MS);
        let out = "";
        try {
          const stream = engine.stream({
            model,
            systemPrompt: opts.systemPrompt ?? "",
            messages: [
              { role: "user", content: [{ type: "text", text: opts.prompt }] },
            ],
            tools: [],
            abortSignal: signal,
            maxOutputTokens: opts.maxOutputTokens ?? 512,
            reasoningEffort: "none",
            temperature: 0,
          });
          for await (const event of stream) {
            if (event.type === "text-delta") out += event.text;
          }
        } finally {
          if (timer) clearTimeout(timer);
        }
        return out;
      },
    };
  }

  const productionRunAgent = productionContextRunnerToken
    ? preserveProductionContextMethod(runAgent, productionContextRunnerToken)
    : runAgent;
  const productionAnalyzeContext = productionContextRunnerToken
    ? preserveProductionContextMethod(
        analyzeContext,
        productionContextRunnerToken,
      )
    : analyzeContext;
  // Enumerable branding preserves production provenance through runner spreads.
  const runner = {
    ...(productionContextRunnerToken
      ? { [productionContextRunnerBrand]: productionContextRunnerToken }
      : {}),
    runAgent: productionRunAgent,
    analyzeContext: productionAnalyzeContext,
    engine: runnerEngine,
    model,
  };
  return runner;
}

async function runProductionChatPath(args: {
  productionChatPath: NonNullable<EvalProductionContext["productionChatPath"]>;
  productionContext: EvalProductionContext;
  input: EvalInput;
  actionAllowlist: readonly string[];
  engine: AgentEngine;
  model: string;
  timeoutMs: number;
}): Promise<AgentRunOutput> {
  const started = Date.now();
  const controller = new AbortController();
  const timeoutError = new Error(
    `Agent run timed out after ${args.timeoutMs} ms.`,
  );
  let timedOut = false;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let partialUsage: AgentLoopUsage | undefined;
  let malformedUsageEvent = false;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(timeoutError);
      reject(timeoutError);
    }, args.timeoutMs);
  });

  try {
    const result = await Promise.race([
      runWithRequestContext(
        {
          userEmail: args.productionContext.ownerEmail,
          orgId: args.productionContext.orgId!,
          isSyntheticTraffic: true,
        },
        () =>
          args.productionChatPath.run({
            input: args.input,
            actionAllowlist: args.actionAllowlist,
            identity: {
              ownerEmail: args.productionContext.ownerEmail,
              orgId: args.productionContext.orgId!,
            },
            engine: args.engine,
            model: args.model,
            signal: controller.signal,
            onUsage: (usage) => {
              if (!finished) {
                const normalizedUsage = normalizeProductionPathUsage(usage, {
                  model: args.model,
                  engineName: args.engine.name,
                });
                if (
                  normalizedUsage &&
                  normalizedUsage.usageReported !== false
                ) {
                  partialUsage = mergePartialUsage(
                    partialUsage,
                    normalizedUsage,
                  );
                } else if (!normalizedUsage) {
                  malformedUsageEvent = true;
                }
              }
            },
          }),
      ),
      timeout,
    ]);
    const receiptError = validateProductionPathRun(
      result,
      args.productionContext,
      args.actionAllowlist,
    );
    if (!result?.output) {
      return malformedProductionPathOutput(
        receiptError ?? "Production chat eval adapter returned no run output.",
        Date.now() - started,
        partialUsage,
      );
    }
    const output = result.output;
    if (!isProductionPathOutput(output)) {
      return malformedProductionPathOutput(
        "Production chat eval adapter returned malformed run output.",
        Date.now() - started,
        partialUsage,
      );
    }
    if (!output.ok) {
      console.error(
        "[eval] Production chat eval adapter returned a failed run",
        { failureType: "returned_run_failure" },
      );
    }
    const outputUsage = normalizeProductionPathUsage(output.usage, {
      model: args.model,
      engineName: args.engine.name,
    });
    const usage =
      outputUsage?.usageReported === true
        ? outputUsage
        : malformedUsageEvent
          ? undefined
          : partialUsage;
    if (!usage) {
      return malformedProductionPathOutput(
        output.ok
          ? "Production chat eval adapter did not return or report usage."
          : "Production agent run failed before usage was captured.",
        Date.now() - started,
      );
    }
    const error =
      receiptError ?? (output.ok ? undefined : "Production chat eval failed.");
    if (error) {
      return malformedProductionPathOutput(error, Date.now() - started, usage);
    }
    return {
      ...output,
      ok: true,
      error: undefined,
      runId: output.runId || `eval:${crypto.randomUUID()}`,
      durationMs: Date.now() - started,
      usage,
    };
  } catch (err) {
    if (!controller.signal.aborted) controller.abort(err);
    if (!timedOut) {
      console.error(
        "[eval] Production chat eval adapter failed",
        productionAdapterErrorDetails(err),
      );
    }
    return malformedProductionPathOutput(
      timedOut ? timeoutError.message : "Production chat eval failed.",
      Date.now() - started,
      partialUsage,
    );
  } finally {
    finished = true;
    if (timer) clearTimeout(timer);
    if (!controller.signal.aborted && timedOut) {
      controller.abort(timeoutError);
    }
  }
}

function productionAdapterErrorDetails(error: unknown): {
  errorType: string;
  statusCode?: number;
} {
  try {
    if (!(error instanceof Error)) {
      return { errorType: error === null ? "null" : typeof error };
    }

    const details = error as Error & {
      status?: unknown;
      statusCode?: unknown;
    };
    const errorType =
      error instanceof AggregateError
        ? "AggregateError"
        : error instanceof TypeError
          ? "TypeError"
          : error instanceof RangeError
            ? "RangeError"
            : error instanceof ReferenceError
              ? "ReferenceError"
              : error instanceof SyntaxError
                ? "SyntaxError"
                : error instanceof URIError
                  ? "URIError"
                  : error instanceof EvalError
                    ? "EvalError"
                    : "Error";
    const statusCode = [details.statusCode, details.status].find(
      (value): value is number =>
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 100 &&
        value <= 599,
    );

    return {
      errorType,
      ...(statusCode ? { statusCode } : {}),
    };
  } catch {
    return { errorType: "Error" };
  }
}

function normalizeProductionPathUsage(
  value: unknown,
  identifiers: { model: string; engineName?: string },
): AgentLoopUsage | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  if (Array.isArray(value)) return undefined;

  const usage = value as Record<string, unknown>;
  const requiredNumberFields = [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
  ] as const;
  const optionalNumberFields = [
    "builderCreditsUsed",
    "llmCalls",
    "followUpMs",
    "followUpInputTokens",
    "receiptUnverifiedCount",
    "receiptChangedFalseCount",
    "firstEngineEventAtMs",
  ] as const;
  const isUsageNumber = (field: string) => {
    const fieldValue = usage[field];
    return (
      typeof fieldValue === "number" &&
      Number.isFinite(fieldValue) &&
      fieldValue >= 0
    );
  };

  if (
    !requiredNumberFields.every(isUsageNumber) ||
    !identifiers.model.trim() ||
    (usage.usageReported !== undefined &&
      typeof usage.usageReported !== "boolean") ||
    optionalNumberFields.some(
      (field) => usage[field] !== undefined && !isUsageNumber(field),
    )
  ) {
    return undefined;
  }

  return {
    inputTokens: usage.inputTokens as number,
    outputTokens: usage.outputTokens as number,
    cacheReadTokens: usage.cacheReadTokens as number,
    cacheWriteTokens: usage.cacheWriteTokens as number,
    // These identifiers come from the runner configuration, not adapter output.
    model: identifiers.model,
    ...(usage.builderCreditsUsed !== undefined
      ? { builderCreditsUsed: usage.builderCreditsUsed as number }
      : {}),
    ...(identifiers.engineName !== undefined
      ? { engineName: identifiers.engineName }
      : {}),
    ...(usage.llmCalls !== undefined
      ? { llmCalls: usage.llmCalls as number }
      : {}),
    ...(usage.followUpMs !== undefined
      ? { followUpMs: usage.followUpMs as number }
      : {}),
    ...(usage.followUpInputTokens !== undefined
      ? { followUpInputTokens: usage.followUpInputTokens as number }
      : {}),
    ...(usage.receiptUnverifiedCount !== undefined
      ? { receiptUnverifiedCount: usage.receiptUnverifiedCount as number }
      : {}),
    ...(usage.receiptChangedFalseCount !== undefined
      ? { receiptChangedFalseCount: usage.receiptChangedFalseCount as number }
      : {}),
    ...(usage.usageReported !== undefined
      ? { usageReported: usage.usageReported as boolean }
      : {}),
    ...(usage.firstEngineEventAtMs !== undefined
      ? { firstEngineEventAtMs: usage.firstEngineEventAtMs as number }
      : {}),
  };
}

function validateProductionPathRun(
  result: EvalProductionPathRun,
  context: EvalProductionContext,
  actionAllowlist: readonly string[],
): string | undefined {
  if (!result || typeof result !== "object" || !result.output) {
    return "Production chat eval adapter returned no run output.";
  }
  const receipt = result.receipt;
  if (
    !receipt ||
    receipt.productionAgentLoopInvoked !== true ||
    receipt.requestPreparationInvoked !== true ||
    receipt.systemPromptBuilt !== true ||
    receipt.finalResponseGuardInstalled !== true ||
    receipt.finalResponseGuardApplied !== true ||
    receipt.usageCaptured !== true
  ) {
    return "Production chat eval adapter did not attest chat handling, request preparation, prompt assembly, final guard, and usage capture.";
  }
  if (
    typeof receipt.ownerEmail !== "string" ||
    typeof receipt.orgId !== "string" ||
    !Array.isArray(receipt.initialToolNames) ||
    !Array.isArray(receipt.availableActionNames) ||
    !Array.isArray(receipt.readOnlyActionNames) ||
    !receipt.initialToolNames.every((name) => typeof name === "string") ||
    !receipt.availableActionNames.every((name) => typeof name === "string") ||
    !receipt.readOnlyActionNames.every((name) => typeof name === "string") ||
    typeof receipt.prefetchStatus !== "string" ||
    !["ok", "empty", "timed_out", "failed"].includes(receipt.prefetchStatus)
  ) {
    return "Production chat eval adapter returned an incomplete setup receipt.";
  }
  if (
    receipt.ownerEmail.trim().toLowerCase() !==
      context.ownerEmail.trim().toLowerCase() ||
    receipt.orgId !== context.orgId
  ) {
    return "Production chat eval adapter returned a different owner or org context.";
  }
  const available = new Set(receipt.availableActionNames);
  const readOnly = new Set(receipt.readOnlyActionNames);
  const initial = new Set(receipt.initialToolNames);
  if (
    available.size === 0 ||
    initial.size === 0 ||
    [...available].some((name) => !readOnly.has(name)) ||
    [...available].some((name) => !actionAllowlist.includes(name)) ||
    [...initial].some((name) => !available.has(name))
  ) {
    return "Production chat eval adapter exposed an empty or non-read-only action surface, or exposed a disallowed action.";
  }
  return undefined;
}

function isProductionPathOutput(value: unknown): value is AgentRunOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const output = value as Record<string, unknown>;
  return (
    typeof output.text === "string" &&
    Array.isArray(output.toolCalls) &&
    Array.from(output.toolCalls).every(
      (toolCall) => typeof toolCall === "string",
    ) &&
    typeof output.ok === "boolean" &&
    typeof output.runId === "string" &&
    typeof output.durationMs === "number" &&
    Number.isFinite(output.durationMs) &&
    output.durationMs >= 0
  );
}

function resolveActionAllowlist(
  actions: Record<string, ActionEntry>,
  requested?: readonly string[],
): readonly string[] {
  const actionAllowlist = requested ?? Object.keys(actions);
  const unknownActions = actionAllowlist.filter((name) => !actions[name]);
  if (unknownActions.length > 0) {
    throw new Error(
      `Eval action allowlist contains unknown actions: ${unknownActions.join(", ")}.`,
    );
  }
  return [...new Set(actionAllowlist)];
}

function filterActionsForEval(
  actions: Record<string, ActionEntry>,
  actionAllowlist: readonly string[],
): Record<string, ActionEntry> {
  const allowed = new Set(actionAllowlist);
  const filtered = Object.fromEntries(
    Object.entries(actions).filter(
      ([name]) => allowed.has(name) && name !== TOOL_SEARCH_ACTION_NAME,
    ),
  );
  if (allowed.has(TOOL_SEARCH_ACTION_NAME)) attachToolSearch(filtered);
  return filtered;
}

function malformedProductionPathOutput(
  error: string,
  durationMs: number,
  usage?: AgentLoopUsage,
): AgentRunOutput {
  const output: UnscoreableProductionPathOutput = {
    [unscoreableProductionPathOutputBrand]: error,
    text: "",
    toolCalls: [],
    ok: false,
    error,
    runId: `eval:${crypto.randomUUID()}`,
    durationMs,
    ...(usage ? { usage } : {}),
  };
  unscoreableProductionPathOutputs.add(output);
  return output;
}

function validateProductionContext(
  context: EvalProductionContext,
): EvalProductionContext {
  if (!context || typeof context !== "object") {
    throw new Error(
      "Production eval context is required. Add evals/production-context.ts and export resolveProductionEvalContext().",
    );
  }
  if (
    typeof context.systemPrompt !== "string" ||
    !context.systemPrompt.trim()
  ) {
    throw new Error(
      "Production eval context must provide the app's non-empty production system prompt.",
    );
  }
  if (
    typeof context.ownerEmail !== "string" ||
    !context.ownerEmail.trim() ||
    !("orgId" in context) ||
    (context.orgId !== null &&
      (typeof context.orgId !== "string" || !context.orgId.trim()))
  ) {
    throw new Error(
      "Production eval context must provide an explicit ownerEmail and orgId (use null only for a deliberate personal-org scope).",
    );
  }
  if (
    !("finalResponseGuard" in context) ||
    (context.finalResponseGuard !== null &&
      typeof context.finalResponseGuard !== "function")
  ) {
    throw new Error(
      "Production eval context must explicitly provide finalResponseGuard (null when the app has none).",
    );
  }
  if (
    !context.actions ||
    typeof context.actions !== "object" ||
    Object.keys(context.actions).length === 0
  ) {
    throw new Error(
      "Production eval context must provide the app's production action registry.",
    );
  }
  return context;
}

function mergePartialUsage(
  total: AgentLoopUsage | undefined,
  next: AgentLoopUsage,
): AgentLoopUsage {
  return {
    inputTokens: (total?.inputTokens ?? 0) + next.inputTokens,
    outputTokens: (total?.outputTokens ?? 0) + next.outputTokens,
    cacheReadTokens: (total?.cacheReadTokens ?? 0) + next.cacheReadTokens,
    cacheWriteTokens: (total?.cacheWriteTokens ?? 0) + next.cacheWriteTokens,
    ...(typeof total?.builderCreditsUsed === "number" ||
    typeof next.builderCreditsUsed === "number"
      ? {
          builderCreditsUsed:
            (total?.builderCreditsUsed ?? 0) + (next.builderCreditsUsed ?? 0),
        }
      : {}),
    engineName: next.engineName ?? total?.engineName,
    model: next.model ?? total?.model ?? "unknown",
    llmCalls: (total?.llmCalls ?? 0) + (next.llmCalls ?? 1),
    usageReported: true,
  };
}
