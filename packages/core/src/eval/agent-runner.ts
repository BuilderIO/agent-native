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
import { actionsToEngineTools } from "../agent/production-agent.js";
import type { AgentChatEvent } from "../agent/types.js";
import { runWithRequestContext } from "../server/request-context.js";
import type {
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
  availableTools?: EngineTool[];
  messages: EngineMessage[];
  actions: Record<string, ActionEntry>;
  send: (event: AgentChatEvent) => void;
  signal: AbortSignal;
  onUsage?: (usage: AgentLoopUsage) => void;
  ownerEmail: string;
  orgId: string | null;
  appId?: string;
  actionCaller?: ActionCaller;
  finalResponseGuard: AgentLoopFinalResponseGuard | null;
  finalResponseGuardRequestText: string;
  runId: string;
}) => Promise<AgentLoopUsage>;

export interface AgentRunnerConfig {
  productionContext: EvalProductionContext;
  engine?: AgentEngine;
  model?: string;
  timeoutMs?: number;
  runLoop?: RunAgentLoopFn;
}

export interface AgentRunner {
  runAgent(input: EvalInput): Promise<AgentRunOutput>;
  analyzeContext(): ScorerAnalyzeContext;
  readonly engine: AgentEngine;
  readonly model: string;
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
  const productionContext = validateProductionContext(config.productionContext);
  const productionChatPath = productionContext.productionChatPath;
  const runLoop = config.runLoop;
  if (!productionChatPath && !runLoop) {
    throw new Error(
      "Production eval requires an adapter that invokes the production chat handler. Direct runAgentLoop is available only through an explicit test runner.",
    );
  }
  if (productionChatPath && !productionContext.orgId) {
    throw new Error(
      "Production chat evals require an explicit organization id.",
    );
  }
  if (
    productionChatPath &&
    (!productionContext.finalResponseGuard ||
      Object.values(productionContext.actions).some(
        (action) => action.readOnly !== true,
      ))
  ) {
    throw new Error(
      "Production chat evals require the real final response guard and a read-only adapter action registry.",
    );
  }
  const engine =
    config.engine ?? (await resolveEngine({ engineOption: undefined }));
  const modelCandidate =
    config.model ??
    (await getStoredModelForEngine(engine)) ??
    engine.defaultModel;
  const model = normalizeModelForEngine(engine, modelCandidate);
  const timeoutMs = config.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;
  const availableTools = actionsToEngineTools(productionContext.actions);
  const initialToolNames = productionContext.initialToolNames
    ? new Set(productionContext.initialToolNames)
    : undefined;
  const tools = initialToolNames
    ? availableTools.filter((tool) => initialToolNames.has(tool.name))
    : availableTools;
  if (tools.length === 0) {
    throw new Error(
      "Production eval context did not expose any initial agent tools.",
    );
  }

  async function runAgent(input: EvalInput): Promise<AgentRunOutput> {
    if (productionChatPath) {
      return runProductionChatPath({
        productionChatPath,
        productionContext,
        input,
        engine,
        model,
        timeoutMs,
      });
    }
    if (!runLoop) {
      throw new Error(
        "Production eval requires an adapter that invokes the production chat handler.",
      );
    }
    const runId = `eval:${crypto.randomUUID()}`;
    const messages = toEngineMessages(input);

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
      usage = await Promise.race([
        runWithRequestContext(
          {
            userEmail: productionContext.ownerEmail,
            ...(productionContext.orgId
              ? { orgId: productionContext.orgId }
              : { orgScope: "personal" as const }),
            isSyntheticTraffic: true,
          },
          () =>
            runLoop({
              engine,
              model,
              systemPrompt: productionContext.systemPrompt,
              tools,
              availableTools,
              messages,
              actions: productionContext.actions,
              send,
              signal: controller.signal,
              ownerEmail: productionContext.ownerEmail,
              orgId: productionContext.orgId,
              ...(productionContext.appId
                ? { appId: productionContext.appId }
                : {}),
              actionCaller: "tool",
              finalResponseGuard: productionContext.finalResponseGuard,
              finalResponseGuardRequestText: input.prompt,
              runId,
              onUsage: (next) => {
                if (finished) return;
                partialUsage = mergePartialUsage(partialUsage, next);
              },
            }),
        ),
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
      engine,
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

  return { runAgent, analyzeContext, engine, model };
}

async function runProductionChatPath(args: {
  productionChatPath: NonNullable<EvalProductionContext["productionChatPath"]>;
  productionContext: EvalProductionContext;
  input: EvalInput;
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
            identity: {
              ownerEmail: args.productionContext.ownerEmail,
              orgId: args.productionContext.orgId!,
            },
            engine: args.engine,
            model: args.model,
            signal: controller.signal,
            onUsage: (usage) => {
              if (!finished) {
                partialUsage = mergePartialUsage(partialUsage, usage);
              }
            },
          }),
      ),
      timeout,
    ]);
    const receiptError = validateProductionPathRun(
      result,
      args.productionContext,
    );
    const output = result.output;
    const usage = output.usage ?? partialUsage;
    if (!usage) {
      return failedProductionPathOutput(
        output,
        "Production chat eval adapter did not return or report usage.",
        Date.now() - started,
      );
    }
    return {
      ...output,
      ok: output.ok && !receiptError,
      ...(receiptError ? { error: receiptError } : {}),
      runId: output.runId || `eval:${crypto.randomUUID()}`,
      durationMs: Date.now() - started,
      usage,
    };
  } catch (err) {
    if (!controller.signal.aborted) controller.abort(err);
    return {
      text: "",
      toolCalls: [],
      ok: false,
      error: timedOut
        ? timeoutError.message
        : err instanceof Error
          ? err.message
          : String(err),
      runId: `eval:${crypto.randomUUID()}`,
      durationMs: Date.now() - started,
      ...(partialUsage ? { usage: partialUsage } : {}),
    };
  } finally {
    finished = true;
    if (timer) clearTimeout(timer);
    if (!controller.signal.aborted && timedOut) {
      controller.abort(timeoutError);
    }
  }
}

function validateProductionPathRun(
  result: EvalProductionPathRun,
  context: EvalProductionContext,
): string | undefined {
  if (!result || typeof result !== "object" || !result.output) {
    return "Production chat eval adapter returned no run output.";
  }
  const receipt = result.receipt;
  if (
    !receipt ||
    receipt.chatHandlerInvoked !== true ||
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
    [...initial].some((name) => !available.has(name))
  ) {
    return "Production chat eval adapter exposed an empty or non-read-only action surface.";
  }
  return undefined;
}

function failedProductionPathOutput(
  output: AgentRunOutput,
  error: string,
  durationMs: number,
): AgentRunOutput {
  return { ...output, ok: false, error, durationMs };
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
