
import type { EngineContentPart, EngineEvent } from "./engine/types.js";

export class TripWire extends Error {
  readonly meta?: Record<string, unknown>;
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

export type ProcessorState = Record<string, unknown>;

export type ProcessorAbort = (
  reason: string,
  meta?: Record<string, unknown>,
) => never;

export interface ProcessOutputStreamArgs {
  part: EngineEvent;
  streamParts: EngineEvent[];
  state: ProcessorState;
  abort: ProcessorAbort;
}

export interface ProcessOutputStepArgs {
  toolCalls: { id: string; name: string; input: unknown }[];
  finishReason?:
    | "end_turn"
    | "tool_use"
    | "max_tokens"
    | "stop_sequence"
    | "error";
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  state: ProcessorState;
  abort: ProcessorAbort;
}

export interface ProcessOutputResultArgs {
  text: string;
  state: ProcessorState;
}

export interface Processor {
  name?: string;
  processOutputStream?(args: ProcessOutputStreamArgs): void | Promise<void>;
  processOutputStep?(args: ProcessOutputStepArgs): void | Promise<void>;
  processOutputResult?(args: ProcessOutputResultArgs): void | Promise<void>;
}

export class ProcessorChain {
  private readonly entries: { processor: Processor; state: ProcessorState }[];
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

  async runResult(text: string): Promise<void> {
    for (const { processor, state } of this.entries) {
      if (!processor.processOutputResult) continue;
      await processor.processOutputResult({ text, state });
    }
  }
}

export function toolCallsFromContent(
  parts: EngineContentPart[],
): { id: string; name: string; input: unknown }[] {
  return parts
    .filter((p): p is Extract<EngineContentPart, { type: "tool-call" }> => {
      return p.type === "tool-call";
    })
    .map((p) => ({ id: p.id, name: p.name, input: p.input }));
}
