
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
import type { ActionEntry, AgentLoopUsage } from "../agent/production-agent.js";
import {
  runAgentLoop,
  actionsToEngineTools,
} from "../agent/production-agent.js";
import type { AgentChatEvent } from "../agent/types.js";
import type {
  AgentRunOutput,
  EvalInput,
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
}) => Promise<AgentLoopUsage>;

export interface AgentRunnerConfig {
  actions: Record<string, ActionEntry>;
  systemPrompt?: string;
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
  const engine =
    config.engine ?? (await resolveEngine({ engineOption: undefined }));
  const modelCandidate =
    config.model ??
    (await getStoredModelForEngine(engine)) ??
    engine.defaultModel;
  const model = normalizeModelForEngine(engine, modelCandidate);
  const systemPrompt = config.systemPrompt ?? "";
  const runLoop = config.runLoop ?? (runAgentLoop as RunAgentLoopFn);
  const timeoutMs = config.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;
  const tools = actionsToEngineTools(config.actions);

  async function runAgent(input: EvalInput): Promise<AgentRunOutput> {
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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();

    const send = (event: AgentChatEvent): void => {
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

    try {
      await runLoop({
        engine,
        model,
        systemPrompt,
        tools,
        messages,
        actions: config.actions,
        send,
        signal: controller.signal,
      });
    } catch (err) {
      ok = false;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }

    return {
      text,
      toolCalls,
      toolCallDetails: toolCallDetails.map(({ id: _id, ...detail }) => detail),
      ok,
      error,
      runId,
      durationMs: Date.now() - started,
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
