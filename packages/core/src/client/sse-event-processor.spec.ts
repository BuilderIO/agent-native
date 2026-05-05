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
