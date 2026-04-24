import type { AgentChatEvent } from "../agent/types.js";
import type { AgentLoopUsage } from "../agent/production-agent.js";
import type { TraceSpan, TraceSummary, ObservabilityConfig } from "./types.js";
import { DEFAULT_OBSERVABILITY_CONFIG } from "./types.js";

function spanId(): string {
  return `span-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function getObservabilityConfig(): Promise<ObservabilityConfig> {
  try {
    const { getSetting } = await import("../settings/store.js");
    const stored = await getSetting("observability-config");
    if (stored) {
      return {
        ...DEFAULT_OBSERVABILITY_CONFIG,
        ...stored,
      } as ObservabilityConfig;
    }
  } catch {}
  return DEFAULT_OBSERVABILITY_CONFIG;
}

/**
 * Wraps `runAgentLoop()` to capture trace spans and a summary.
 *
 * Transparent — the agent sees the exact same events and tool calls it
 * would without instrumentation. We intercept the `send` callback to
 * observe tool_start / tool_done / usage events, then forward them
 * untouched to the real send.
 */
export async function instrumentAgentLoop(opts: {
  runAgentLoop: (loopOpts: {
    engine: any;
    model: string;
    systemPrompt: string;
    tools: any[];
    messages: any[];
    actions: Record<string, any>;
    send: (event: AgentChatEvent) => void;
    signal: AbortSignal;
    providerOptions?: any;
  }) => Promise<AgentLoopUsage>;
  loopOpts: {
    engine: any;
    model: string;
    systemPrompt: string;
    tools: any[];
    messages: any[];
    actions: Record<string, any>;
    send: (event: AgentChatEvent) => void;
    signal: AbortSignal;
    providerOptions?: any;
  };
  runId: string;
  threadId: string | null;
  config: ObservabilityConfig;
}): Promise<AgentLoopUsage> {
  const { runAgentLoop, loopOpts, runId, threadId, config } = opts;
  const runStart = Date.now();
  const parentSpanId = spanId();

  const spans: TraceSpan[] = [];
  const pendingTools = new Map<
    string,
    { spanId: string; startMs: number; input: Record<string, string> }
  >();

  let llmCallCount = 0;
  let toolCallCount = 0;
  let successfulTools = 0;
  let failedTools = 0;

  const instrumentedSend = (event: AgentChatEvent): void => {
    try {
      if (event.type === "tool_start") {
        const sid = spanId();
        pendingTools.set(event.tool, {
          spanId: sid,
          startMs: Date.now(),
          input: event.input,
        });
      } else if (event.type === "tool_done") {
        const pending = pendingTools.get(event.tool);
        pendingTools.delete(event.tool);
        toolCallCount++;

        const isError = event.result.startsWith("Error");
        if (isError) failedTools++;
        else successfulTools++;

        const span: TraceSpan = {
          id: pending?.spanId ?? spanId(),
          runId,
          threadId,
          parentSpanId,
          spanType: "tool_call",
          name: event.tool,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costCentsX100: 0,
          durationMs: pending ? Date.now() - pending.startMs : 0,
          status: isError ? "error" : "success",
          errorMessage: isError ? event.result : null,
          metadata:
            config.captureToolArgs && pending ? { input: pending.input } : null,
          createdAt: Date.now(),
        };
        spans.push(span);
      }
    } catch {}

    loopOpts.send(event);
  };

  let usage: AgentLoopUsage;
  let runStatus: "success" | "error" = "success";
  let errorMessage: string | null = null;
  try {
    usage = await runAgentLoop({ ...loopOpts, send: instrumentedSend });
  } catch (err: any) {
    runStatus = "error";
    errorMessage = err?.message ?? String(err);
    throw err;
  } finally {
    const runEnd = Date.now();
    const totalDurationMs = runEnd - runStart;

    let costCentsX100 = 0;
    try {
      const { calculateCost } = await import("../usage/store.js");
      const u = usage!;
      costCentsX100 = u
        ? calculateCost(
            u.inputTokens,
            u.outputTokens,
            u.model,
            u.cacheReadTokens,
            u.cacheWriteTokens,
          )
        : 0;
    } catch {}

    if (usage!) {
      llmCallCount = Math.max(
        1,
        spans.filter((s) => s.spanType === "llm_call").length || 1,
      );

      const llmSpan: TraceSpan = {
        id: spanId(),
        runId,
        threadId,
        parentSpanId,
        spanType: "llm_call",
        name: usage!.model,
        inputTokens: usage!.inputTokens,
        outputTokens: usage!.outputTokens,
        cacheReadTokens: usage!.cacheReadTokens,
        cacheWriteTokens: usage!.cacheWriteTokens,
        costCentsX100,
        durationMs: totalDurationMs,
        status: runStatus,
        errorMessage,
        metadata: null,
        createdAt: runStart,
      };
      spans.push(llmSpan);
      llmCallCount = 1;
    }

    const parentSpan: TraceSpan = {
      id: parentSpanId,
      runId,
      threadId,
      parentSpanId: null,
      spanType: "agent_run",
      name: "agent_run",
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      cacheReadTokens: usage?.cacheReadTokens ?? 0,
      cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
      costCentsX100,
      durationMs: totalDurationMs,
      status: runStatus,
      errorMessage,
      metadata: null,
      createdAt: runStart,
    };
    spans.push(parentSpan);

    const summary: TraceSummary = {
      runId,
      threadId,
      totalSpans: spans.length,
      llmCalls: llmCallCount,
      toolCalls: toolCallCount,
      successfulTools,
      failedTools,
      totalDurationMs,
      totalCostCentsX100: costCentsX100,
      totalInputTokens: usage?.inputTokens ?? 0,
      totalOutputTokens: usage?.outputTokens ?? 0,
      model: usage?.model ?? loopOpts.model,
      createdAt: runStart,
    };

    writeTraceData(spans, summary).catch(() => {});
  }

  return usage!;
}

async function writeTraceData(
  spans: TraceSpan[],
  summary: TraceSummary,
): Promise<void> {
  const { insertTraceSpan, upsertTraceSummary } = await import("./store.js");
  await Promise.all(spans.map((s) => insertTraceSpan(s).catch(() => {})));
  await upsertTraceSummary(summary).catch(() => {});
}
