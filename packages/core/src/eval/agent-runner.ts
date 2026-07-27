/**
 * The headless agent-run seam used by the evals runner.
 *
 * This invokes the real `runAgentLoop` as a *caller* — resolving a provider-
 * agnostic engine + model from the existing registry, converting the app's
 * actions into engine tools, and collecting the assistant's text + tool calls
 * off the `send` event stream into a compact `AgentRunOutput`. It deliberately
 * does NOT modify `production-agent.ts`: everything it needs (`runAgentLoop`,
 * `actionsToEngineTools`, `ActionEntry`) is already exported from there.
 *
 * The factory shape (`createAgentRunner`) keeps the runner unit-testable: tests
 * inject a fake `runAgentLoop` and a fake engine so no real model is called,
 * while production wires in the genuine loop. The same factory builds the
 * `ScorerAnalyzeContext.judge` helper so LLM-judge scorers stream through the
 * exact same resolved engine.
 */

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

/** The slice of `runAgentLoop` the runner depends on — injectable for tests. */
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
  /** App actions to expose to the agent under test. */
  actions: Record<string, ActionEntry>;
  /** System prompt for the run. */
  systemPrompt?: string;
  /** Pre-resolved engine; resolved from the registry when omitted. */
  engine?: AgentEngine;
  /** Pre-resolved model; resolved from the engine's stored/default when omitted. */
  model?: string;
  /** Per-run wall-clock budget in ms (default 120s). */
  timeoutMs?: number;
  /**
   * Seam for tests / custom hosts. Defaults to the real `runAgentLoop`. The
   * runner never imports `runAgentLoop` directly so this can be swapped.
   */
  runLoop?: RunAgentLoopFn;
}

export interface AgentRunner {
  /** Run the agent loop for one eval input and collect a compact output. */
  runAgent(input: EvalInput): Promise<AgentRunOutput>;
  /** Analyze context handed to LLM-judge scorers (shares engine/model). */
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

/**
 * Build an agent runner, resolving the engine/model once up front so every
 * eval case (and every LLM-judge scorer) reuses the same provider-agnostic
 * config. Resolution goes through `resolveEngine` — no model is ever hardcoded.
 */
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
    let ok = true;
    let error: string | undefined;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();

    const send = (event: AgentChatEvent): void => {
      switch (event.type) {
        case "text":
          text += event.text;
          break;
        case "tool_start":
          toolCalls.push(event.tool);
          break;
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
