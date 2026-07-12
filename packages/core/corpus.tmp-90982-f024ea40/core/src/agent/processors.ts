/**
 * In-loop processor seam for the agent loop.
 *
 * A `Processor` is loop-internal *configuration* — not a tool, not an authoring
 * DSL, not an action. It observes the model's streamed output and tool calls as
 * the run progresses, may mutate its own per-processor `state`, and may `abort()`
 * the run. This is the structural prerequisite for real-time guardrails and a
 * proof-of-done / coverage gate: code that can watch the model mid-run and halt
 * it (or surface a verdict) before a "done" is claimed.
 *
 * Borrowed from Mastra's output processors. The shape is intentionally minimal:
 *
 *   - `processOutputStream` fires per streamed chunk (text / thinking deltas,
 *     etc.) while the model is generating, so a guardrail can react before the
 *     full turn lands.
 *   - `processOutputStep` fires once per model response, around tool execution,
 *     with the tool calls the model just requested. A coverage gate can inspect
 *     what the model is about to do and abort.
 *   - `processOutputResult` fires once at run end with the final text.
 *
 * All hooks are OPTIONAL. When no processors are supplied to `runAgentLoop`, the
 * loop must not run any of this code — the no-processors path is byte-for-byte
 * unchanged and carries zero overhead (callers guard on a non-empty array).
 *
 * Each processor gets its own mutable `state` object that persists across every
 * hook invocation for that processor within a single run, and is isolated from
 * other processors' state.
 */

import type { EngineContentPart, EngineEvent } from "./engine/types.js";

/**
 * Thrown by a processor's `abort()` to halt the run gracefully. The loop catches
 * it, emits a `tripwire` event, and stops. Carries the human-readable `reason`
 * plus optional structured `meta` and the originating `processor` name.
 *
 * Lives here (not in production-agent) so any consumer can `instanceof` it
 * without an import cycle.
 */
export class TripWire extends Error {
  /** Optional structured metadata supplied at the abort site. */
  readonly meta?: Record<string, unknown>;
  /** Name of the processor that aborted, when known. */
  readonly processor?: string;
  constructor(
    reason: string,
    opts?: { meta?: Record<string, unknown>; processor?: string },
  ) {
    super(reason);
    this.name = "TripWire";
    this.meta = opts?.meta;
    this.processor = opts?.processor;
  }
}

/**
 * Per-processor mutable scratch space. Each processor sees the SAME object
 * across all of its hook invocations within one run; processors never see each
 * other's state.
 */
export type ProcessorState = Record<string, unknown>;

/** Halts the run by throwing a {@link TripWire}. Never returns normally. */
export type ProcessorAbort = (
  reason: string,
  meta?: Record<string, unknown>,
) => never;

/** A single streamed chunk plus the running list of chunks seen so far. */
export interface ProcessOutputStreamArgs {
  /** The chunk that just streamed from the engine. */
  part: EngineEvent;
  /** Every chunk observed so far this turn, including `part`. */
  streamParts: EngineEvent[];
  /** This processor's mutable, isolated, run-scoped state. */
  state: ProcessorState;
  /** Halt the run; throws {@link TripWire}. */
  abort: ProcessorAbort;
}

/** Context for a completed model response, fired around tool execution. */
export interface ProcessOutputStepArgs {
  /** Tool calls the model requested in this step (empty for a final answer). */
  toolCalls: { id: string; name: string; input: unknown }[];
  /** Terminal stop reason for the step, when the engine reported one. */
  finishReason?:
    | "end_turn"
    | "tool_use"
    | "max_tokens"
    | "stop_sequence"
    | "error";
  /** Cumulative token usage for the run so far, when available. */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  /** This processor's mutable, isolated, run-scoped state. */
  state: ProcessorState;
  /** Halt the run; throws {@link TripWire}. */
  abort: ProcessorAbort;
}

/** Context for the end of the whole run. */
export interface ProcessOutputResultArgs {
  /** The final assistant text for the run. */
  text: string;
  /** This processor's mutable, isolated, run-scoped state. */
  state: ProcessorState;
}

/**
 * A loop-internal observer/guardrail. All hooks are optional; implement only
 * the ones a given guardrail needs. Hooks may be sync or async.
 */
export interface Processor {
  /** Stable name, surfaced on `tripwire` events and in per-processor errors. */
  name?: string;
  /** Called per streamed chunk while the model generates. */
  processOutputStream?(args: ProcessOutputStreamArgs): void | Promise<void>;
  /** Called once per model response, around tool execution. */
  processOutputStep?(args: ProcessOutputStepArgs): void | Promise<void>;
  /** Called once at run end with the final text. */
  processOutputResult?(args: ProcessOutputResultArgs): void | Promise<void>;
}

/**
 * Runs a chain of processors over the loop's lifecycle. Created once per run;
 * isolates each processor's `state`, runs hooks in registration order, and
 * converts a processor's `abort()` (or any thrown `TripWire`) into a single
 * halt signal the loop can act on.
 *
 * The executor is only constructed when at least one processor is supplied, so
 * the no-processors path never touches any of this.
 */
export class ProcessorChain {
  private readonly entries: { processor: Processor; state: ProcessorState }[];
  /** Accumulates every stream chunk so each `processOutputStream` call sees the running list. */
  private readonly streamParts: EngineEvent[] = [];

  constructor(processors: Processor[]) {
    this.entries = processors.map((processor) => ({
      processor,
      state: {},
    }));
  }

  private makeAbort(processor: Processor): ProcessorAbort {
    const processorName = processor.name;
    return (reason, meta) => {
      throw new TripWire(reason, {
        ...(meta ? { meta } : {}),
        ...(processorName ? { processor: processorName } : {}),
      });
    };
  }

  /** Fire `processOutputStream` for every processor that implements it. */
  async runStream(part: EngineEvent): Promise<void> {
    this.streamParts.push(part);
    for (const { processor, state } of this.entries) {
      if (!processor.processOutputStream) continue;
      await processor.processOutputStream({
        part,
        streamParts: this.streamParts,
        state,
        abort: this.makeAbort(processor),
      });
    }
  }

  /** Fire `processOutputStep` for every processor that implements it. */
  async runStep(args: {
    toolCalls: { id: string; name: string; input: unknown }[];
    finishReason?: ProcessOutputStepArgs["finishReason"];
    usage?: ProcessOutputStepArgs["usage"];
  }): Promise<void> {
    for (const { processor, state } of this.entries) {
      if (!processor.processOutputStep) continue;
      await processor.processOutputStep({
        toolCalls: args.toolCalls,
        ...(args.finishReason ? { finishReason: args.finishReason } : {}),
        ...(args.usage ? { usage: args.usage } : {}),
        state,
        abort: this.makeAbort(processor),
      });
    }
  }

  /** Fire `processOutputResult` for every processor that implements it. */
  async runResult(text: string): Promise<void> {
    for (const { processor, state } of this.entries) {
      if (!processor.processOutputResult) continue;
      await processor.processOutputResult({ text, state });
    }
  }
}

/** Engine content parts → the plain tool-call shape passed to `processOutputStep`. */
export function toolCallsFromContent(
  parts: EngineContentPart[],
): { id: string; name: string; input: unknown }[] {
  return parts
    .filter((p): p is Extract<EngineContentPart, { type: "tool-call" }> => {
      return p.type === "tool-call";
    })
    .map((p) => ({ id: p.id, name: p.name, input: p.input }));
}
