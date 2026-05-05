import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentAutoContinueSignal,
  readSSEStream,
  readSSEStreamRaw,
  SSE_NO_PROGRESS_TIMEOUT_MS,
} from "./sse-event-processor.js";

function commentOnlyStream(delayMs: number): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      setTimeout(() => {
        controller.enqueue(
          new TextEncoder().encode(`: ping ${Date.now()}\n\n`),
        );
      }, delayMs);
    },
  });
}

function eventStream(events: unknown[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
        ),
      );
      controller.close();
    },
  });
}

async function drain(iterable: AsyncIterable<unknown>) {
  const results: unknown[] = [];
  for await (const result of iterable) {
    results.push(result);
  }
  return results;
}

describe("SSE event processor no-progress recovery", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("turns comment-only live streams into an auto-continuation signal", async () => {
    vi.useFakeTimers();

    const errPromise = (async () => {
      try {
        for await (const _ of readSSEStream(
          commentOnlyStream(SSE_NO_PROGRESS_TIMEOUT_MS + 1),
          [],
          { value: 0 },
          undefined,
        )) {
          // no-op
        }
      } catch (err) {
        return err;
      }
    })();

    await vi.advanceTimersByTimeAsync(SSE_NO_PROGRESS_TIMEOUT_MS + 1);
    const err = await errPromise;

    expect(err).toBeInstanceOf(AgentAutoContinueSignal);
    expect((err as AgentAutoContinueSignal).reason).toBe("no_progress");
  });

  it("turns raw comment-only live streams into an auto-continuation signal", async () => {
    vi.useFakeTimers();
    const onUpdate = vi.fn();

    const errPromise = readSSEStreamRaw(
      commentOnlyStream(SSE_NO_PROGRESS_TIMEOUT_MS + 1),
      [],
      { value: 0 },
      undefined,
      onUpdate,
    ).then(
      () => undefined,
      (err) => err,
    );

    await vi.advanceTimersByTimeAsync(SSE_NO_PROGRESS_TIMEOUT_MS + 1);
    const err = await errPromise;

    expect(err).toBeInstanceOf(AgentAutoContinueSignal);
    expect((err as AgentAutoContinueSignal).reason).toBe("no_progress");
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe("SSE event processor error classification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("routes authentication failures to auth handling", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;

        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    await drain(
      readSSEStream(
        eventStream([{ type: "error", error: "Authentication required" }]),
        [],
        { value: 0 },
        "tab-auth",
      ),
    );

    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:auth-error" }),
    );
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:missing-api-key" }),
    );
  });

  it("routes missing provider credentials to the setup gate", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });

    await drain(
      readSSEStream(
        eventStream([
          {
            type: "error",
            error: "No LLM provider is connected",
            errorCode: "missing_credentials",
          },
        ]),
        [],
        { value: 0 },
        "tab-missing",
      ),
    );

    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:missing-api-key" }),
    );
  });
});
