import { Buffer } from "node:buffer";
import { types } from "node:util";

import type { EngineEvent, EngineStreamOptions } from "./engine/types.js";

/**
 * Sizes describe UTF-8 engine arguments before provider adaptation. Stream
 * arrivals are client observations, not provider queue or compute timings.
 */
export interface ModelAttemptMetrics {
  model: string;
  reasoningEffort?: EngineStreamOptions["reasoningEffort"];
  iteration: number;
  retry: number;
  startedAtMs: number;
  dispatchedAtMs?: number;
  firstEventAtMs?: number;
  firstThinkingAtMs?: number;
  lastThinkingAtMs?: number;
  firstTextAtMs?: number;
  lastTextAtMs?: number;
  endedAtMs: number;
  /** Recovery after the failed stream ends, including cleanup and backoff. */
  retryWaitMs: number;
  streamedThinkingBytes: number;
  streamedTextBytes: number;
  streamedToolInputBytes: number;
  usageReported: boolean;
  request?: {
    systemPromptBytes: number;
    messagesBytes: number;
    toolsBytes: number;
    messageCount: number;
    toolCount: number;
    /** Registered tool names only; other results share the [unlisted] bucket. */
    toolResultBytes: Record<string, number>;
  };
  requestSizeUnavailable?: true;
}

export type ModelAttemptObserver = (
  metrics: ModelAttemptMetrics,
  id: symbol,
) => void | Promise<void>;

export type ModelAttemptStartObserver = (id: symbol) => void | Promise<void>;

function notify(observe: () => void | Promise<void>): void {
  try {
    const result = observe();
    if (result !== undefined) {
      void Promise.resolve(result).catch(() => {
        // coercion-ok: telemetry observers cannot change agent execution.
      });
    }
  } catch {
    // coercion-ok: telemetry observers cannot change agent execution.
  }
}

function assertMeasurementSafe(
  value: unknown,
  ancestors = new Set<object>(),
  budget = { remaining: 100_000 },
): void {
  if (--budget.remaining < 0) throw new Error("Request measurement too large");
  if (value === null || value === undefined) return;
  if (["string", "number", "boolean"].includes(typeof value)) return;
  if (typeof value !== "object" || types.isProxy(value)) {
    throw new Error("Unsupported request measurement value");
  }
  const prototype = Object.getPrototypeOf(value);
  if (
    (prototype !== null &&
      prototype !== Object.prototype &&
      prototype !== Array.prototype) ||
    Object.getOwnPropertyDescriptor(Object.prototype, "toJSON") ||
    Object.getOwnPropertyDescriptor(Array.prototype, "toJSON") ||
    (Array.isArray(value) && value.length > 100_000) ||
    ancestors.has(value)
  ) {
    throw new Error("Unsupported request measurement object");
  }
  ancestors.add(value);
  try {
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) {
        throw new Error("Request measurement cannot invoke accessors");
      }
      assertMeasurementSafe(descriptor.value, ancestors, budget);
    }
  } finally {
    ancestors.delete(value);
  }
}

export class ModelAttemptMeasurement {
  private readonly id = Symbol("model-attempt");
  private readonly metrics: Omit<ModelAttemptMetrics, "endedAtMs">;
  private endedAtMs: number | undefined;

  constructor(
    model: string,
    iteration: number,
    retry: number,
    onStart?: ModelAttemptStartObserver,
  ) {
    this.metrics = {
      model,
      iteration,
      retry,
      startedAtMs: Date.now(),
      retryWaitMs: 0,
      streamedThinkingBytes: 0,
      streamedTextBytes: 0,
      streamedToolInputBytes: 0,
      usageReported: false,
    };
    if (onStart) notify(() => onStart(this.id));
  }

  request(options: EngineStreamOptions): void {
    try {
      if (types.isProxy(options))
        throw new Error("Unsupported request measurement");
      for (const key of ["messages", "tools", "systemPrompt"] as const) {
        const descriptor = Object.getOwnPropertyDescriptor(options, key);
        if (!descriptor || !("value" in descriptor)) {
          throw new Error("Request measurement requires own data properties");
        }
        assertMeasurementSafe(descriptor.value);
      }
      const effort = Object.getOwnPropertyDescriptor(
        options,
        "reasoningEffort",
      );
      if (effort) {
        if (!("value" in effort))
          throw new Error("Request measurement cannot invoke accessors");
        if (options.reasoningEffort !== undefined)
          this.metrics.reasoningEffort = options.reasoningEffort;
      }
      const toolResultBytes: Record<string, number> = Object.create(null);
      const registeredTools = new Set(options.tools.map((tool) => tool.name));
      for (const message of options.messages) {
        for (const part of message.content) {
          if (part.type === "tool-result") {
            const name = registeredTools.has(part.toolName)
              ? part.toolName
              : "[unlisted]";
            toolResultBytes[name] =
              (toolResultBytes[name] ?? 0) + Buffer.byteLength(part.content);
          }
        }
      }
      this.metrics.request = {
        systemPromptBytes: Buffer.byteLength(options.systemPrompt),
        messagesBytes: Buffer.byteLength(JSON.stringify(options.messages)),
        toolsBytes: Buffer.byteLength(JSON.stringify(options.tools)),
        messageCount: options.messages.length,
        toolCount: options.tools.length,
        toolResultBytes,
      };
    } catch {
      // coercion-ok: unavailable measurements cannot block model dispatch.
      this.metrics.requestSizeUnavailable = true;
    }
  }

  dispatched(): void {
    this.metrics.dispatchedAtMs ??= Date.now();
  }

  event(event: EngineEvent): void {
    if (event.type === "gateway-heartbeat") return;
    const now = Date.now();
    this.metrics.firstEventAtMs ??= now;
    if (event.type === "thinking-delta" && event.text) {
      this.metrics.firstThinkingAtMs ??= now;
      this.metrics.lastThinkingAtMs = now;
      this.metrics.streamedThinkingBytes += Buffer.byteLength(event.text);
    } else if (event.type === "text-delta" && event.text) {
      this.metrics.firstTextAtMs ??= now;
      this.metrics.lastTextAtMs = now;
      this.metrics.streamedTextBytes += Buffer.byteLength(event.text);
    } else if (event.type === "tool-input-delta" && event.text) {
      this.metrics.streamedToolInputBytes += Buffer.byteLength(event.text);
    } else if (event.type === "usage") {
      this.metrics.usageReported = true;
    }
  }

  endStream(): number {
    this.endedAtMs ??= Date.now();
    return this.endedAtMs;
  }

  retryWait(ms: number): void {
    this.metrics.retryWaitMs += ms;
  }

  finish(observer: ModelAttemptObserver): void {
    this.endStream();
    notify(() =>
      observer(
        {
          ...this.metrics,
          endedAtMs: this.endedAtMs ?? Date.now(),
        },
        this.id,
      ),
    );
  }
}
