import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AgentAutoContinueSignal,
  readSSEStream,
  readSSEStreamRaw,
  SSE_ACTION_PREPARATION_STALL_TIMEOUT_MS,
  SSE_DURABLE_ACTION_PREPARATION_STALL_TIMEOUT_MS,
  SSE_DURABLE_NO_PROGRESS_TIMEOUT_MS,
  SSE_NO_PROGRESS_TIMEOUT_MS,
} from "./sse-event-processor.js";

function commentOnlyStream(delayMs: number): ReadableStream<Uint8Array> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setTimeout(() => {
        try {
          controller.enqueue(
            new TextEncoder().encode(`: ping ${Date.now()}\n\n`),
          );
        } catch {
          // The watchdog may have cancelled the stream first.
        }
      }, delayMs);
    },
    cancel() {
      if (timer) clearTimeout(timer);
    },
  });
}

function silentStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start() {
      // Keep the stream open without data to exercise the client-side timer.
    },
  });
}

function keepaliveThenDelayedDoneStream(
  keepaliveAtMs: number,
  doneAtMs: number,
): ReadableStream<Uint8Array> {
  const timers: ReturnType<typeof setTimeout>[] = [];
  return new ReadableStream<Uint8Array>({
    start(controller) {
      timers.push(
        setTimeout(() => {
          try {
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({ type: "stream_keepalive" })}\n\n`,
              ),
            );
          } catch {
            // The watchdog may have cancelled the stream first.
          }
        }, keepaliveAtMs),
      );
      timers.push(
        setTimeout(() => {
          try {
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({ type: "done" })}\n\n`,
              ),
            );
            controller.close();
          } catch {
            // The watchdog may have cancelled the stream first.
          }
        }, doneAtMs),
      );
    },
    cancel() {
      for (const timer of timers) clearTimeout(timer);
    },
  });
}

function activityThenKeepaliveStream(
  keepaliveAtMs: number,
): ReadableStream<Uint8Array> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({
            type: "activity",
            label: "Still generating image",
            tool: "generate-image",
          })}\n\n`,
        ),
      );
      timer = setTimeout(() => {
        try {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ type: "stream_keepalive" })}\n\n`,
            ),
          );
        } catch {
          // The watchdog may have cancelled the stream first.
        }
      }, keepaliveAtMs);
    },
    cancel() {
      if (timer) clearTimeout(timer);
    },
  });
}

function preparingActionKeepaliveStream(
  tool = "edit-design",
): ReadableStream<Uint8Array> {
  let timer: ReturnType<typeof setInterval> | undefined;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({
            type: "activity",
            label: `Preparing ${tool} action`,
            tool,
          })}\n\n`,
        ),
      );
      timer = setInterval(() => {
        try {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ type: "stream_keepalive" })}\n\n`,
            ),
          );
        } catch {
          // The watchdog may have cancelled the stream first.
        }
      }, 10_000);
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });
}

function preparingActionZeroByteActivityStream(
  tool = "edit-design",
  intervalMs = 30_000,
): ReadableStream<Uint8Array> {
  let timer: ReturnType<typeof setInterval> | undefined;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const sendActivity = () => {
        controller.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({
              type: "activity",
              label: `Preparing ${tool} action`,
              tool,
              progressBytes: 0,
            })}\n\n`,
          ),
        );
      };
      sendActivity();
      timer = setInterval(() => {
        try {
          sendActivity();
        } catch {
          // The watchdog may have cancelled the stream first.
        }
      }, intervalMs);
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });
}

function preparingActionZeroByteActivityThenDoneStream(
  tool = "edit-design",
  intervalMs = 30_000,
  doneAtMs = SSE_ACTION_PREPARATION_STALL_TIMEOUT_MS + 30_000,
): ReadableStream<Uint8Array> {
  let interval: ReturnType<typeof setInterval> | undefined;
  let doneTimer: ReturnType<typeof setTimeout> | undefined;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const sendActivity = () => {
        controller.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({
              type: "activity",
              label: `Preparing ${tool} action`,
              tool,
              progressBytes: 0,
            })}\n\n`,
          ),
        );
      };
      sendActivity();
      interval = setInterval(() => {
        try {
          sendActivity();
        } catch {
          // The watchdog may have cancelled the stream first.
        }
      }, intervalMs);
      doneTimer = setTimeout(() => {
        try {
          if (interval) clearInterval(interval);
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ type: "done" })}\n\n`,
            ),
          );
          controller.close();
        } catch {
          // The watchdog may have cancelled the stream first.
        }
      }, doneAtMs);
    },
    cancel() {
      if (interval) clearInterval(interval);
      if (doneTimer) clearTimeout(doneTimer);
    },
  });
}

function preparingActionProgressStream(
  tool = "edit-design",
  intervalMs = 30_000,
  progressEventCount = 4,
): ReadableStream<Uint8Array> {
  let timer: ReturnType<typeof setInterval> | undefined;
  let count = 0;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({
            type: "activity",
            label: `Preparing ${tool} action`,
            tool,
          })}\n\n`,
        ),
      );
      timer = setInterval(() => {
        count += 1;
        try {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                type: "activity",
                label: `Preparing ${tool} action`,
                tool,
                progressBytes: count * 32_768,
              })}\n\n`,
            ),
          );
          if (count >= progressEventCount) {
            if (timer) clearInterval(timer);
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({
                  type: "tool_start",
                  tool,
                  input: {},
                })}\n\n`,
              ),
            );
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({
                  type: "tool_done",
                  tool,
                  result: "ok",
                })}\n\n`,
              ),
            );
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({ type: "done" })}\n\n`,
              ),
            );
            controller.close();
          }
        } catch {
          // The watchdog may have cancelled the stream first.
        }
      }, intervalMs);
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });
}

function parallelSameToolPreparationStream(
  tool = "edit-design",
): ReadableStream<Uint8Array> {
  const timers: ReturnType<typeof setTimeout>[] = [];
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({
            type: "activity",
            label: `Preparing ${tool} action`,
            tool,
            id: "call-a",
            progressBytes: 65_536,
          })}\n\n`,
        ),
      );
      timers.push(
        setTimeout(() => {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                type: "activity",
                label: `Preparing ${tool} action`,
                tool,
                id: "call-b",
                progressBytes: 32_768,
              })}\n\n`,
            ),
          );
        }, 30_000),
      );
      timers.push(
        setTimeout(() => {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                type: "tool_start",
                tool,
                id: "call-b",
                input: {},
              })}\n\n`,
            ),
          );
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                type: "tool_done",
                tool,
                id: "call-b",
                result: "ok",
              })}\n\n`,
            ),
          );
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ type: "done" })}\n\n`,
            ),
          );
          controller.close();
        }, SSE_NO_PROGRESS_TIMEOUT_MS + 5_000),
      );
    },
    cancel() {
      for (const timer of timers) clearTimeout(timer);
    },
  });
}

function parallelSameToolStalledSiblingStream(
  tool = "edit-design",
): ReadableStream<Uint8Array> {
  const timers: ReturnType<typeof setTimeout>[] = [];
  let keepalive: ReturnType<typeof setInterval> | undefined;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({
            type: "activity",
            label: `Preparing ${tool} action`,
            tool,
            id: "call-a",
            progressBytes: 0,
          })}\n\n`,
        ),
      );
      timers.push(
        setTimeout(() => {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                type: "tool_start",
                tool,
                id: "call-b",
                input: {},
              })}\n\n`,
            ),
          );
        }, 30_000),
      );
      keepalive = setInterval(() => {
        try {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ type: "stream_keepalive" })}\n\n`,
            ),
          );
        } catch {
          // The watchdog may have cancelled the stream first.
        }
      }, 10_000);
    },
    cancel() {
      for (const timer of timers) clearTimeout(timer);
      if (keepalive) clearInterval(keepalive);
    },
  });
}

function clearedOlderSameToolSiblingStream(
  tool = "edit-design",
): ReadableStream<Uint8Array> {
  const timers: ReturnType<typeof setTimeout>[] = [];
  let keepalive: ReturnType<typeof setInterval> | undefined;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({
            type: "activity",
            label: `Preparing ${tool} action`,
            tool,
            id: "call-a",
            progressBytes: 0,
          })}\n\n`,
        ),
      );
      timers.push(
        setTimeout(() => {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                type: "activity",
                label: `Preparing ${tool} action`,
                tool,
                id: "call-b",
                progressBytes: 0,
              })}\n\n`,
            ),
          );
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                type: "tool_start",
                tool,
                id: "call-a",
                input: {},
              })}\n\n`,
            ),
          );
        }, 60_000),
      );
      timers.push(
        setTimeout(() => {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                type: "tool_start",
                tool,
                id: "call-b",
                input: {},
              })}\n\n`,
            ),
          );
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                type: "tool_done",
                tool,
                id: "call-b",
                result: "ok",
              })}\n\n`,
            ),
          );
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ type: "done" })}\n\n`,
            ),
          );
          controller.close();
        }, SSE_ACTION_PREPARATION_STALL_TIMEOUT_MS + 10_000),
      );
      keepalive = setInterval(() => {
        try {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ type: "stream_keepalive" })}\n\n`,
            ),
          );
        } catch {
          // The watchdog may have cancelled the stream first.
        }
      }, 10_000);
    },
    cancel() {
      for (const timer of timers) clearTimeout(timer);
      if (keepalive) clearInterval(keepalive);
    },
  });
}

function noIdPositivePreparationFallbackStream(
  tool = "edit-design",
): ReadableStream<Uint8Array> {
  const timers: ReturnType<typeof setTimeout>[] = [];
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({
            type: "activity",
            label: `Preparing ${tool} action`,
            tool,
            progressBytes: 65_536,
          })}\n\n`,
        ),
      );
      timers.push(
        setTimeout(() => {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                type: "activity",
                label: `Preparing ${tool} action`,
                tool,
                progressBytes: 32_768,
              })}\n\n`,
            ),
          );
        }, 30_000),
      );
      timers.push(
        setTimeout(() => {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ type: "done" })}\n\n`,
            ),
          );
          controller.close();
        }, SSE_NO_PROGRESS_TIMEOUT_MS + 5_000),
      );
    },
    cancel() {
      for (const timer of timers) clearTimeout(timer);
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

  it("turns silent live streams into an auto-continuation signal", async () => {
    vi.useFakeTimers();

    const errPromise = (async () => {
      try {
        for await (const _ of readSSEStream(
          silentStream(),
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

    await vi.advanceTimersByTimeAsync(SSE_NO_PROGRESS_TIMEOUT_MS);
    const err = await errPromise;

    expect(err).toBeInstanceOf(AgentAutoContinueSignal);
    expect((err as AgentAutoContinueSignal).reason).toBe("no_progress");
  });

  it("stream_keepalive events do not reset the no-progress watchdog", async () => {
    vi.useFakeTimers();

    const errPromise = (async () => {
      try {
        for await (const _ of readSSEStream(
          keepaliveThenDelayedDoneStream(
            SSE_NO_PROGRESS_TIMEOUT_MS - 5_000,
            SSE_NO_PROGRESS_TIMEOUT_MS + 5_000,
          ),
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

    await vi.advanceTimersByTimeAsync(SSE_NO_PROGRESS_TIMEOUT_MS - 5_000);
    await vi.advanceTimersByTimeAsync(10_000);
    const err = await errPromise;

    expect(err).toBeInstanceOf(AgentAutoContinueSignal);
    expect((err as AgentAutoContinueSignal).reason).toBe("no_progress");
  });

  it("preserves activity trail when keepalive-only streams hit no-progress recovery", async () => {
    vi.useFakeTimers();

    const errPromise = (async () => {
      try {
        for await (const _ of readSSEStream(
          activityThenKeepaliveStream(SSE_NO_PROGRESS_TIMEOUT_MS),
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

    await vi.advanceTimersByTimeAsync(SSE_NO_PROGRESS_TIMEOUT_MS);
    const err = await errPromise;

    expect(err).toBeInstanceOf(AgentAutoContinueSignal);
    expect((err as AgentAutoContinueSignal).reason).toBe("no_progress");
    expect((err as AgentAutoContinueSignal).activityTrail).toEqual([
      {
        label: "Still generating image",
        tool: "generate-image",
      },
    ]);
  });

  it("does not let keepalives hide a stalled action preparation", async () => {
    vi.useFakeTimers();

    const errPromise = (async () => {
      try {
        for await (const _ of readSSEStream(
          preparingActionKeepaliveStream(),
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

    await vi.advanceTimersByTimeAsync(
      SSE_ACTION_PREPARATION_STALL_TIMEOUT_MS + 1,
    );
    const err = await errPromise;

    expect(err).toBeInstanceOf(AgentAutoContinueSignal);
    expect((err as AgentAutoContinueSignal).reason).toBe("no_progress");
    expect((err as AgentAutoContinueSignal).activityTrail).toEqual([
      {
        label: "Preparing edit screen action",
        tool: "edit-design",
      },
    ]);
  });

  it("does not let repeated zero-byte preparation activity hide a stalled action", async () => {
    vi.useFakeTimers();

    const errPromise = (async () => {
      try {
        for await (const _ of readSSEStream(
          preparingActionZeroByteActivityStream(),
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
    expect((err as AgentAutoContinueSignal).activityTrail).toEqual([
      {
        label: "Preparing edit screen action",
        tool: "edit-design",
      },
    ]);
  });

  // UPDATED: durable background reads now use the widened
  // SSE_DURABLE_ACTION_PREPARATION_STALL_TIMEOUT_MS window so the SERVER's own
  // 150s no-progress backstop recovers a stall first (the client is a reader,
  // not a second recovery brain). A genuinely silent prep still recovers —
  // just on the durable window, never at the foreground 90s mark.
  it("recovers a durable background stream stuck on zero-byte preparation activity", async () => {
    vi.useFakeTimers();

    const errPromise = (async () => {
      try {
        await drain(
          readSSEStream(
            preparingActionZeroByteActivityThenDoneStream(
              "edit-design",
              30_000,
              SSE_DURABLE_ACTION_PREPARATION_STALL_TIMEOUT_MS + 60_000,
            ),
            [],
            { value: 0 },
            undefined,
            undefined,
            undefined,
            { durableBackgroundRun: true },
          ),
        );
      } catch (err) {
        return err;
      }
    })();

    // The foreground 90s window must NOT fire for a durable background read.
    await vi.advanceTimersByTimeAsync(
      SSE_ACTION_PREPARATION_STALL_TIMEOUT_MS + 1,
    );
    expect(await Promise.race([errPromise, Promise.resolve("pending")])).toBe(
      "pending",
    );

    await vi.advanceTimersByTimeAsync(
      SSE_DURABLE_ACTION_PREPARATION_STALL_TIMEOUT_MS -
        SSE_ACTION_PREPARATION_STALL_TIMEOUT_MS,
    );

    const err = await errPromise;

    expect(err).toBeInstanceOf(AgentAutoContinueSignal);
    expect((err as AgentAutoContinueSignal).reason).toBe("no_progress");
    expect((err as AgentAutoContinueSignal).activityTrail).toEqual([
      {
        label: "Preparing edit screen action",
        tool: "edit-design",
      },
    ]);
  });

  // UPDATED: durable background reads recover on the widened durable stall
  // window (see the durable constants) instead of the foreground 90s window,
  // so the server's own recovery gets first chance.
  it("recovers a durable background stream stuck on preparation keepalives", async () => {
    vi.useFakeTimers();

    const errPromise = (async () => {
      try {
        for await (const _ of readSSEStream(
          preparingActionKeepaliveStream(),
          [],
          { value: 0 },
          undefined,
          undefined,
          undefined,
          { durableBackgroundRun: true },
        )) {
          // no-op
        }
      } catch (err) {
        return err;
      }
    })();

    await vi.advanceTimersByTimeAsync(
      SSE_DURABLE_ACTION_PREPARATION_STALL_TIMEOUT_MS + 1,
    );
    const err = await errPromise;

    expect(err).toBeInstanceOf(AgentAutoContinueSignal);
    expect((err as AgentAutoContinueSignal).reason).toBe("no_progress");
    expect((err as AgentAutoContinueSignal).activityTrail).toEqual([
      {
        label: "Preparing edit screen action",
        tool: "edit-design",
      },
    ]);
  });

  it("carries zero-byte preparation stalls across durable reconnect reads", async () => {
    vi.useFakeTimers();

    const preparingActionState = {};
    const readPreparationReplay = async (id: string) => {
      try {
        await drain(
          readSSEStream(
            eventStream([
              {
                type: "activity",
                label: "Preparing edit-design action",
                tool: "edit-design",
                id,
                progressBytes: 0,
              },
            ]),
            [],
            { value: 0 },
            undefined,
            undefined,
            undefined,
            { durableBackgroundRun: true, preparingActionState },
          ),
        );
      } catch (err) {
        return err;
      }
      return undefined;
    };

    // UPDATED: the shared preparation watchdog state still carries stall age
    // across reconnect reads, measured against the widened durable window
    // (SSE_DURABLE_ACTION_PREPARATION_STALL_TIMEOUT_MS) instead of the
    // foreground 90s window.
    const firstErr = await readPreparationReplay("call-a");
    expect(firstErr).toBeInstanceOf(AgentAutoContinueSignal);
    expect((firstErr as AgentAutoContinueSignal).reason).toBe("stream_ended");

    await vi.advanceTimersByTimeAsync(
      Math.floor(SSE_DURABLE_ACTION_PREPARATION_STALL_TIMEOUT_MS / 2),
    );

    const secondErr = await readPreparationReplay("call-b");
    expect(secondErr).toBeInstanceOf(AgentAutoContinueSignal);
    expect((secondErr as AgentAutoContinueSignal).reason).toBe("stream_ended");

    await vi.advanceTimersByTimeAsync(
      Math.ceil(SSE_DURABLE_ACTION_PREPARATION_STALL_TIMEOUT_MS / 2) + 1,
    );

    const thirdErr = await readPreparationReplay("call-c");
    expect(thirdErr).toBeInstanceOf(AgentAutoContinueSignal);
    expect((thirdErr as AgentAutoContinueSignal).reason).toBe("no_progress");
    expect((thirdErr as AgentAutoContinueSignal).activityTrail).toEqual([
      {
        label: "Preparing edit screen action",
        tool: "edit-design",
      },
    ]);
  });

  it("keeps durable background keepalives attached until a terminal event", async () => {
    vi.useFakeTimers();

    const donePromise = drain(
      readSSEStream(
        keepaliveThenDelayedDoneStream(
          30_000,
          SSE_NO_PROGRESS_TIMEOUT_MS + 5_000,
        ),
        [],
        { value: 0 },
        undefined,
        undefined,
        undefined,
        { durableBackgroundRun: true },
      ),
    );

    await vi.advanceTimersByTimeAsync(SSE_NO_PROGRESS_TIMEOUT_MS + 5_000);

    await expect(donePromise).resolves.toBeDefined();
  });

  it("holds a silent durable background read past the foreground no-progress window, then reattaches", async () => {
    vi.useFakeTimers();

    const errPromise = (async () => {
      try {
        await drain(
          readSSEStream(
            silentStream(),
            [],
            { value: 0 },
            undefined,
            undefined,
            undefined,
            { durableBackgroundRun: true },
          ),
        );
      } catch (err) {
        return err;
      }
    })();

    expect(SSE_DURABLE_NO_PROGRESS_TIMEOUT_MS).toBe(13 * 60_000);

    // The foreground 75s no-progress window must NOT fire for a durable
    // background read — the server-side background backstop owns stall
    // recovery and its auto_continue event normally arrives over this same
    // stream first.
    await vi.advanceTimersByTimeAsync(SSE_NO_PROGRESS_TIMEOUT_MS + 1_000);
    expect(await Promise.race([errPromise, Promise.resolve("pending")])).toBe(
      "pending",
    );

    // Past the widened durable window, a truly dead transport still detaches
    // so the adapter's follow loop can re-poll /runs/active and reattach.
    await vi.advanceTimersByTimeAsync(
      SSE_DURABLE_NO_PROGRESS_TIMEOUT_MS - SSE_NO_PROGRESS_TIMEOUT_MS,
    );
    const err = await errPromise;

    expect(err).toBeInstanceOf(AgentAutoContinueSignal);
    expect((err as AgentAutoContinueSignal).reason).toBe("no_progress");
  });

  it("does not stall while a large tool input is still streaming progress", async () => {
    vi.useFakeTimers();

    const donePromise = drain(
      readSSEStream(
        preparingActionProgressStream(),
        [],
        { value: 0 },
        undefined,
      ),
    );

    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
    }

    await expect(donePromise).resolves.toBeDefined();
  });

  it("does not stall a durable background run while large tool input is still streaming progress", async () => {
    vi.useFakeTimers();

    const donePromise = drain(
      readSSEStream(
        preparingActionProgressStream(),
        [],
        { value: 0 },
        undefined,
        undefined,
        undefined,
        { durableBackgroundRun: true },
      ),
    );

    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
    }

    await expect(donePromise).resolves.toBeDefined();
  });

  it("tracks parallel same-tool preparation progress by activity id", async () => {
    vi.useFakeTimers();

    const donePromise = drain(
      readSSEStream(
        parallelSameToolPreparationStream(),
        [],
        { value: 0 },
        undefined,
      ),
    );

    await vi.advanceTimersByTimeAsync(SSE_NO_PROGRESS_TIMEOUT_MS + 5_000);

    await expect(donePromise).resolves.toBeDefined();
  });

  it("keeps sibling same-tool preparations tracked after an id-specific tool starts", async () => {
    vi.useFakeTimers();

    const errPromise = (async () => {
      try {
        await drain(
          readSSEStream(
            parallelSameToolStalledSiblingStream(),
            [],
            { value: 0 },
            undefined,
            undefined,
            undefined,
            { durableBackgroundRun: true },
          ),
        );
      } catch (err) {
        return err;
      }
    })();

    // UPDATED: durable background reads stall on the widened durable window.
    await vi.advanceTimersByTimeAsync(
      SSE_DURABLE_ACTION_PREPARATION_STALL_TIMEOUT_MS + 1,
    );

    const err = await errPromise;
    expect(err).toBeInstanceOf(AgentAutoContinueSignal);
    expect((err as AgentAutoContinueSignal).reason).toBe("no_progress");
  });

  it("recomputes same-tool preparation age after an older sibling clears", async () => {
    vi.useFakeTimers();

    const donePromise = drain(
      readSSEStream(
        clearedOlderSameToolSiblingStream(),
        [],
        { value: 0 },
        undefined,
        undefined,
        undefined,
        { durableBackgroundRun: true },
      ),
    );

    await vi.advanceTimersByTimeAsync(
      SSE_ACTION_PREPARATION_STALL_TIMEOUT_MS + 10_000,
    );

    await expect(donePromise).resolves.toBeDefined();
  });

  it("keeps no-id positive preparation heartbeats meaningful", async () => {
    vi.useFakeTimers();

    const donePromise = drain(
      readSSEStream(
        noIdPositivePreparationFallbackStream(),
        [],
        { value: 0 },
        undefined,
      ),
    );

    await vi.advanceTimersByTimeAsync(SSE_NO_PROGRESS_TIMEOUT_MS + 5_000);

    await expect(donePromise).resolves.toBeDefined();
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

  it("turns raw silent live streams into an auto-continuation signal", async () => {
    vi.useFakeTimers();
    const onUpdate = vi.fn();

    const errPromise = readSSEStreamRaw(
      silentStream(),
      [],
      { value: 0 },
      undefined,
      onUpdate,
    ).then(
      () => undefined,
      (err) => err,
    );

    await vi.advanceTimersByTimeAsync(SSE_NO_PROGRESS_TIMEOUT_MS);
    const err = await errPromise;

    expect(err).toBeInstanceOf(AgentAutoContinueSignal);
    expect((err as AgentAutoContinueSignal).reason).toBe("no_progress");
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("preserves raw activity trail when keepalive-only streams hit no-progress recovery", async () => {
    vi.useFakeTimers();
    const onUpdate = vi.fn();

    const errPromise = readSSEStreamRaw(
      activityThenKeepaliveStream(SSE_NO_PROGRESS_TIMEOUT_MS),
      [],
      { value: 0 },
      undefined,
      onUpdate,
    ).then(
      () => undefined,
      (err) => err,
    );

    await vi.advanceTimersByTimeAsync(SSE_NO_PROGRESS_TIMEOUT_MS);
    const err = await errPromise;

    expect(err).toBeInstanceOf(AgentAutoContinueSignal);
    expect((err as AgentAutoContinueSignal).reason).toBe("no_progress");
    expect((err as AgentAutoContinueSignal).activityTrail).toEqual([
      {
        label: "Still generating image",
        tool: "generate-image",
      },
    ]);
  });

  it("turns raw streams that close without a terminal event into a recovery signal", async () => {
    const content: any[] = [];
    const onUpdate = vi.fn();

    const err = await readSSEStreamRaw(
      eventStream([{ type: "text", text: "partial" }]),
      content,
      { value: 0 },
      undefined,
      onUpdate,
    ).then(
      () => undefined,
      (caught) => caught,
    );

    expect(err).toBeInstanceOf(AgentAutoContinueSignal);
    expect((err as AgentAutoContinueSignal).reason).toBe("stream_ended");
    expect(onUpdate).toHaveBeenCalledWith([{ type: "text", text: "partial" }]);
  });

  it("updates raw stream consumers after each meaningful event in the same chunk", async () => {
    const onUpdate = vi.fn();

    await readSSEStreamRaw(
      eventStream([
        { type: "tool_start", id: "call-1", tool: "hubspot-deals", input: {} },
        {
          type: "tool_done",
          id: "call-1",
          tool: "hubspot-deals",
          result: "ok",
        },
        { type: "text", text: "Done." },
        { type: "done" },
      ]),
      [],
      { value: 0 },
      undefined,
      onUpdate,
    );

    expect(onUpdate).toHaveBeenCalledTimes(4);
    expect(onUpdate.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        type: "tool-call",
        toolName: "hubspot-deals",
      }),
    ]);
    expect(onUpdate.mock.calls[0][0][0].result).toBeUndefined();
    expect(onUpdate.mock.calls[1][0]).toEqual([
      expect.objectContaining({
        type: "tool-call",
        toolName: "hubspot-deals",
        result: "ok",
      }),
    ]);
    expect(onUpdate.mock.calls[2][0]).toEqual([
      expect.objectContaining({ type: "tool-call" }),
      { type: "text", text: "Done." },
    ]);
  });

  it("turns raw keepalive-only action preparation into a recovery signal", async () => {
    vi.useFakeTimers();
    const onUpdate = vi.fn();

    const errPromise = readSSEStreamRaw(
      preparingActionKeepaliveStream(),
      [],
      { value: 0 },
      undefined,
      onUpdate,
    ).then(
      () => undefined,
      (err) => err,
    );

    await vi.advanceTimersByTimeAsync(
      SSE_ACTION_PREPARATION_STALL_TIMEOUT_MS + 1,
    );
    const err = await errPromise;

    expect(err).toBeInstanceOf(AgentAutoContinueSignal);
    expect((err as AgentAutoContinueSignal).reason).toBe("no_progress");
    expect((err as AgentAutoContinueSignal).activityTrail).toEqual([
      {
        label: "Preparing edit screen action",
        tool: "edit-design",
      },
    ]);
    expect(onUpdate).toHaveBeenCalledWith([
      expect.objectContaining({
        type: "tool-call",
        toolName: "edit-design",
        activity: true,
      }),
    ]);
  });

  it("does not stall raw streams while a large tool input is still streaming progress", async () => {
    vi.useFakeTimers();
    const onUpdate = vi.fn();

    const donePromise = readSSEStreamRaw(
      preparingActionProgressStream(),
      [],
      { value: 0 },
      undefined,
      onUpdate,
    );

    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
    }

    await expect(donePromise).resolves.toBeUndefined();
    expect(onUpdate).toHaveBeenCalledWith([
      expect.objectContaining({
        type: "tool-call",
        toolName: "edit-design",
        activity: true,
      }),
    ]);
  });

  it("carries activity trail on auto-continuation signals", async () => {
    const err = await (async () => {
      try {
        for await (const _ of readSSEStream(
          eventStream([
            {
              type: "activity",
              label: "Preparing create-extension action",
              tool: "create-extension",
            },
            { type: "auto_continue", reason: "run_timeout" },
          ]),
          [],
          { value: 0 },
          undefined,
        )) {
          // no-op
        }
      } catch (caught) {
        return caught;
      }
    })();

    expect(err).toBeInstanceOf(AgentAutoContinueSignal);
    expect((err as AgentAutoContinueSignal).reason).toBe("run_timeout");
    expect((err as AgentAutoContinueSignal).activityTrail).toEqual([
      {
        label: "Preparing create extension action",
        tool: "create-extension",
      },
    ]);
  });
});

describe("SSE event processor error classification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("routes stream authentication failures to run-error handling", async () => {
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
      expect.objectContaining({
        type: "agent-chat:run-error",
        detail: {
          message: "Authentication required",
          tabId: "tab-auth",
        },
      }),
    );
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:missing-api-key" }),
    );
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:auth-error" }),
    );
  });

  it("routes invalid token stream errors to run-error handling", async () => {
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
        eventStream([
          {
            type: "error",
            error: "Invalid token",
            errorCode: "authentication_error",
          },
        ]),
        [],
        { value: 0 },
        "tab-invalid-token",
      ),
    );

    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:run-error" }),
    );
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:auth-error" }),
    );
  });

  it("routes http auth error codes inside streams to run-error handling", async () => {
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
        eventStream([
          { type: "error", error: "Forbidden", errorCode: "http_403" },
        ]),
        [],
        { value: 0 },
        "tab-http-403",
      ),
    );

    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:run-error",
        detail: {
          message: "Forbidden",
          errorCode: "http_403",
          tabId: "tab-http-403",
        },
      }),
    );
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:auth-error" }),
    );
  });

  it("routes recoverable http_403 stream errors to run-error handling", async () => {
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
        eventStream([
          {
            type: "error",
            error: "Forbidden",
            errorCode: "http_403",
            recoverable: true,
          },
        ]),
        [],
        { value: 0 },
        "tab-http-403",
      ),
    );

    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:run-error",
        detail: {
          message: "Forbidden",
          errorCode: "http_403",
          recoverable: true,
          tabId: "tab-http-403",
        },
      }),
    );
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:auth-error" }),
    );
  });

  it("routes missing provider credentials through the run-error card", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });

    const results = await drain(
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
      expect.objectContaining({
        type: "agent-chat:missing-api-key",
        detail: { tabId: "tab-missing" },
      }),
    );
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:run-error" }),
    );
    expect(results[0]).toEqual({
      content: [{ type: "text", text: "Error: No LLM provider is connected" }],
      status: { type: "incomplete", reason: "error" },
      metadata: {
        custom: {
          runError: {
            message: "No LLM provider is connected",
            errorCode: "missing_credentials",
          },
        },
      },
    });
  });

  it("surfaces provider rate limits as terminal run errors", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });

    const results = await drain(
      readSSEStream(
        eventStream([
          {
            type: "error",
            error: "429 status code (no body)",
            errorCode: "provider_rate_limited",
            details: "429 status code (no body)",
          },
        ]),
        [],
        { value: 0 },
        "tab-rate-limit",
      ),
    );

    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:run-error",
        detail: {
          message:
            "The model provider is rate-limiting this chat right now. Wait a moment, then retry.",
          details: "429 status code (no body)",
          errorCode: "provider_rate_limited",
          tabId: "tab-rate-limit",
        },
      }),
    );
    expect(results[0]).toEqual({
      content: [
        {
          type: "text",
          text: "Error: The model provider is rate-limiting this chat right now. Wait a moment, then retry.",
        },
      ],
      status: { type: "incomplete", reason: "error" },
      metadata: {
        custom: {
          runError: {
            message:
              "The model provider is rate-limiting this chat right now. Wait a moment, then retry.",
            details: "429 status code (no body)",
            errorCode: "provider_rate_limited",
          },
        },
      },
    });
  });

  it("surfaces bare provider auth failures as terminal run errors", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });

    const results = await drain(
      readSSEStream(
        eventStream([
          {
            type: "error",
            error: "401 status code (no body)",
            details: "401 status code (no body)",
          },
        ]),
        [],
        { value: 0 },
        "tab-provider-auth",
      ),
    );

    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:run-error",
        detail: {
          message:
            "The model provider rejected the saved API key. Update the key in API Keys & Connections, then retry.",
          details: "401 status code (no body)",
          tabId: "tab-provider-auth",
        },
      }),
    );
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:auth-error" }),
    );
    expect(results[0]).toEqual({
      content: [
        {
          type: "text",
          text: "Error: The model provider rejected the saved API key. Update the key in API Keys & Connections, then retry.",
        },
      ],
      status: { type: "incomplete", reason: "error" },
      metadata: {
        custom: {
          runError: {
            message:
              "The model provider rejected the saved API key. Update the key in API Keys & Connections, then retry.",
            details: "401 status code (no body)",
          },
        },
      },
    });
  });

  it("maps legacy missing_api_key SSE frames to credential run errors", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });

    const results = await drain(
      readSSEStream(
        eventStream([{ type: "missing_api_key" }]),
        [],
        { value: 0 },
        "tab-missing-legacy",
      ),
    );

    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:missing-api-key",
        detail: { tabId: "tab-missing-legacy" },
      }),
    );
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:run-error" }),
    );
    expect(results[0]?.content).toEqual([
      {
        type: "text",
        text: expect.stringMatching(/^Error: No LLM provider is connected/),
      },
    ]);
    expect(results[0]?.status).toEqual({
      type: "incomplete",
      reason: "error",
    });
    expect(results[0]?.metadata?.custom?.runError).toEqual(
      expect.objectContaining({
        errorCode: "missing_credentials",
      }),
    );
  });

  it("errors when a terminal stream leaves tool-scoped activity unresolved", async () => {
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

    const results = await drain(
      readSSEStream(
        eventStream([
          {
            type: "activity",
            label: "Preparing create-document action",
            tool: "create-document",
          },
          { type: "done" },
        ]),
        [],
        { value: 0 },
        "tab-activity",
      ),
    );

    expect(results).toEqual([
      {
        content: [
          expect.objectContaining({
            type: "tool-call",
            toolName: "create-document",
            argsText: "",
            args: {},
            activity: true,
          }),
        ],
        metadata: {
          custom: {
            activityTrail: [
              {
                label: "Preparing create document action",
                tool: "create-document",
              },
            ],
          },
        },
      },
      {
        content: [
          expect.objectContaining({
            type: "tool-call",
            toolName: "create-document",
            argsText: "",
            args: {},
            activity: true,
            isError: true,
            result: "Stopped before this action started.",
          }),
          {
            type: "text",
            text: "Error: The agent stopped before starting the create document action. No tool result was returned, so the requested changes were not made.",
          },
        ],
        status: {
          type: "incomplete",
          reason: "error",
        },
        metadata: {
          custom: {
            activityTrail: [
              {
                label: "Preparing create document action",
                tool: "create-document",
              },
            ],
            runError: {
              message:
                "The agent stopped before starting the create document action. No tool result was returned, so the requested changes were not made.",
              details: "interrupted_actions: create-document",
              errorCode: "action_not_started",
              recoverable: true,
            },
          },
        },
      },
    ]);
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:activity",
        detail: {
          label: "Starting create document...",
          tool: "create-document",
          tabId: "tab-activity",
        },
      }),
    );
  });

  it("includes streamed tool-input size in visible preparation activity", async () => {
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

    const results = await drain(
      readSSEStream(
        eventStream([
          {
            type: "activity",
            label: "Preparing create-document action",
            tool: "create-document",
            progressBytes: 1536,
          },
          { type: "tool_start", tool: "create-document", input: {} },
          { type: "tool_done", tool: "create-document", result: "ok" },
          { type: "done" },
        ]),
        [],
        { value: 0 },
        "tab-activity-progress",
      ),
    );

    expect(results[0]).toEqual({
      content: [
        expect.objectContaining({
          type: "tool-call",
          toolName: "create-document",
          activity: true,
        }),
      ],
      metadata: {
        custom: {
          activityTrail: [
            {
              label: "Preparing create document action",
              tool: "create-document",
            },
          ],
        },
      },
    });
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:activity",
        detail: {
          label: "Writing create document... (1.5 KB prepared)",
          tool: "create-document",
          tabId: "tab-activity-progress",
        },
      }),
    );
  });

  it("hides zero-byte preparation counts from visible activity", async () => {
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
        eventStream([
          {
            type: "activity",
            label: "Preparing create-document action",
            tool: "create-document",
            progressBytes: 0,
          },
          { type: "tool_start", tool: "create-document", input: {} },
          { type: "tool_done", tool: "create-document", result: "ok" },
          { type: "done" },
        ]),
        [],
        { value: 0 },
        "tab-activity-progress-zero",
      ),
    );

    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:activity",
        detail: {
          label: "Preparing create document...",
          tool: "create-document",
          tabId: "tab-activity-progress-zero",
        },
      }),
    );
    const visibleLabels = dispatchEvent.mock.calls
      .map((call) => (call[0] as CustomEvent<{ label?: string }>).detail?.label)
      .filter(Boolean);
    expect(visibleLabels).not.toEqual(
      expect.arrayContaining([expect.stringContaining("0 B")]),
    );
  });

  it("does not render non-tool activity as visible content", async () => {
    const results = await drain(
      readSSEStream(
        eventStream([
          {
            type: "activity",
            label: "Contacting model",
          },
          { type: "done" },
        ]),
        [],
        { value: 0 },
        "tab-activity",
      ),
    );

    expect(results).toEqual([
      {
        content: [],
        metadata: {
          custom: {
            activityTrail: [
              {
                label: "Contacting model",
              },
            ],
          },
        },
      },
    ]);
  });

  it("fills the pending tool activity card when tool_start arrives", async () => {
    const results = await drain(
      readSSEStream(
        eventStream([
          {
            type: "activity",
            label: "Preparing generate-design action",
            tool: "generate-design",
          },
          {
            type: "tool_start",
            tool: "generate-design",
            input: { designId: "design-1" },
          },
          {
            type: "tool_done",
            tool: "generate-design",
            result: '{"saved":true}',
          },
          { type: "done" },
        ]),
        [],
        { value: 0 },
        "tab-tool-activity",
      ),
    );

    expect(results[0].content).toEqual([
      expect.objectContaining({
        type: "tool-call",
        toolName: "generate-design",
        argsText: "",
        args: {},
        activity: true,
      }),
    ]);
    expect(results[1].content).toEqual([
      expect.objectContaining({
        type: "tool-call",
        toolName: "generate-design",
        argsText: '{"designId":"design-1"}',
        args: { designId: "design-1" },
      }),
    ]);
    expect(results[2].content).toEqual([
      expect.objectContaining({
        type: "tool-call",
        toolName: "generate-design",
        result: '{"saved":true}',
      }),
    ]);
  });

  it("coalesces adjacent duplicate completed tool calls", async () => {
    const results = await drain(
      readSSEStream(
        eventStream([
          {
            type: "tool_start",
            tool: "update-dashboard",
            id: "call-1",
            input: { dashboardId: "dash-1" },
          },
          {
            type: "tool_done",
            tool: "update-dashboard",
            id: "call-1",
            result: '{"saved":true}',
          },
          {
            type: "tool_start",
            tool: "update-dashboard",
            id: "call-2",
            input: { dashboardId: "dash-1" },
          },
          {
            type: "tool_done",
            tool: "update-dashboard",
            id: "call-2",
            result: '{"saved":true}',
          },
          { type: "done" },
        ]),
        [],
        { value: 0 },
        "tab-tool-repeat",
      ),
    );

    const finalContent = results.at(-1)?.content ?? [];
    const toolCalls = finalContent.filter(
      (part): part is Extract<ContentPart, { type: "tool-call" }> =>
        part.type === "tool-call",
    );
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toEqual(
      expect.objectContaining({
        toolName: "update-dashboard",
        result: '{"saved":true}',
        repeatCount: 2,
      }),
    );
  });

  it("ignores replayed completed tool events with the same server id", async () => {
    const results = await drain(
      readSSEStream(
        eventStream([
          {
            type: "tool_start",
            tool: "delete-file",
            id: "call-1",
            input: { fileId: "screen-1" },
          },
          {
            type: "tool_done",
            tool: "delete-file",
            id: "call-1",
            result: '{"deleted":true}',
          },
          { type: "text", text: "Continuing with the selected screen." },
          {
            type: "tool_start",
            tool: "delete-file",
            id: "call-1",
            input: { fileId: "screen-1" },
          },
          {
            type: "tool_done",
            tool: "delete-file",
            id: "call-1",
            result: '{"deleted":true}',
          },
          { type: "done" },
        ]),
        [],
        { value: 0 },
        "tab-tool-replay",
      ),
    );

    const finalContent = results.at(-1)?.content ?? [];
    const toolCalls = finalContent.filter(
      (part): part is Extract<ContentPart, { type: "tool-call" }> =>
        part.type === "tool-call",
    );
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toEqual(
      expect.objectContaining({
        toolCallId: "call-1",
        toolName: "delete-file",
        result: '{"deleted":true}',
      }),
    );
  });

  it("adds a visible warning when a run completes after tools but sends no final text", async () => {
    const results = await drain(
      readSSEStream(
        eventStream([
          {
            type: "tool_start",
            tool: "show-design-questions",
            input: { designId: "design-1" },
          },
          {
            type: "tool_done",
            tool: "show-design-questions",
            result: '{"designId":"design-1","count":5}',
            completedSideEffect: true,
          },
          { type: "done" },
        ]),
        [],
        { value: 0 },
        "tab-tool-only",
        undefined,
        "run-tool-only",
      ),
    );

    const last = results.at(-1) as any;
    expect(last).toMatchObject({
      status: { type: "complete", reason: "stop" },
      metadata: {
        custom: {
          runId: "run-tool-only",
          runWarning: {
            errorCode: "final_response_missing_after_tool",
            recoverable: true,
          },
        },
      },
    });
    expect(last.content).toEqual([
      expect.objectContaining({
        type: "tool-call",
        toolName: "show-design-questions",
        result: '{"designId":"design-1","count":5}',
        completedSideEffect: true,
      }),
      {
        type: "text",
        text: "The agent completed the show design questions action, but stopped before sending a final message. Review the completed tool card above or ask the agent to continue.",
      },
    ]);
  });

  it("adds a visible warning when a run stops after a tool even if it sent text before the tool", async () => {
    const results = await drain(
      readSSEStream(
        eventStream([
          {
            type: "text",
            text: "I'll generate the full app now.",
          },
          {
            type: "tool_start",
            tool: "generate-design",
            input: { designId: "design-1" },
          },
          {
            type: "tool_done",
            tool: "generate-design",
            result: '{"saved":true}',
            completedSideEffect: true,
          },
          { type: "done" },
        ]),
        [],
        { value: 0 },
        "tab-text-before-tool",
        undefined,
        "run-text-before-tool",
      ),
    );

    const last = results.at(-1) as any;
    expect(last).toMatchObject({
      status: { type: "complete", reason: "stop" },
      metadata: {
        custom: {
          runId: "run-text-before-tool",
          runWarning: {
            errorCode: "final_response_missing_after_tool",
            recoverable: true,
          },
        },
      },
    });
    expect(last.content).toEqual([
      {
        type: "text",
        text: "I'll generate the full app now.",
      },
      expect.objectContaining({
        type: "tool-call",
        toolName: "generate-design",
        result: '{"saved":true}',
        completedSideEffect: true,
      }),
      {
        type: "text",
        text: "The agent completed the generate design action, but stopped before sending a final message. Review the completed tool card above or ask the agent to continue.",
      },
    ]);
  });

  it("adds a visible warning when a tool returns after the final assistant text", async () => {
    const results = await drain(
      readSSEStream(
        eventStream([
          {
            type: "tool_start",
            tool: "generate-design",
            input: { designId: "design-1" },
          },
          {
            type: "text",
            text: "I'm generating the full app now.",
          },
          {
            type: "tool_done",
            tool: "generate-design",
            result: '{"saved":true}',
            completedSideEffect: true,
          },
          { type: "done" },
        ]),
        [],
        { value: 0 },
        "tab-tool-result-after-text",
        undefined,
        "run-tool-result-after-text",
      ),
    );

    const last = results.at(-1) as any;
    expect(last).toMatchObject({
      status: { type: "complete", reason: "stop" },
      metadata: {
        custom: {
          runId: "run-tool-result-after-text",
          runWarning: {
            errorCode: "final_response_missing_after_tool",
            recoverable: true,
          },
        },
      },
    });
    expect(last.content).toEqual([
      expect.objectContaining({
        type: "tool-call",
        toolName: "generate-design",
        result: '{"saved":true}',
        completedSideEffect: true,
      }),
      {
        type: "text",
        text: "I'm generating the full app now.",
      },
      {
        type: "text",
        text: "The agent completed the generate design action, but stopped before sending a final message. Review the completed tool card above or ask the agent to continue.",
      },
    ]);
  });

  it("does not add a missing-final warning when text arrives after the last completed tool", async () => {
    const results = await drain(
      readSSEStream(
        eventStream([
          {
            type: "tool_start",
            tool: "generate-design",
            input: { designId: "design-1" },
          },
          {
            type: "tool_done",
            tool: "generate-design",
            result: '{"saved":true}',
            completedSideEffect: true,
          },
          {
            type: "text",
            text: "Done — the app is ready.",
          },
          { type: "done" },
        ]),
        [],
        { value: 0 },
        "tab-text-after-tool",
        undefined,
        "run-text-after-tool",
      ),
    );

    const last = results.at(-1) as any;
    expect(last.metadata?.custom?.runWarning).toBeUndefined();
    expect(last.content).toEqual([
      expect.objectContaining({
        type: "tool-call",
        toolName: "generate-design",
        result: '{"saved":true}',
        completedSideEffect: true,
      }),
      {
        type: "text",
        text: "Done — the app is ready.",
      },
    ]);
  });

  it("errors when a terminal stream leaves a started tool unresolved", async () => {
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
    const results = await drain(
      readSSEStream(
        eventStream([
          {
            type: "tool_start",
            tool: "present-design-variants",
            input: { designId: "design-1" },
          },
          { type: "done" },
        ]),
        [],
        { value: 0 },
        "tab-unfinished-tool",
      ),
    );

    expect(results.at(-1)).toEqual({
      content: [
        expect.objectContaining({
          type: "tool-call",
          toolName: "present-design-variants",
          result: "Interrupted before this tool returned a result.",
        }),
        {
          type: "text",
          text: "Error: The agent stopped before the present design variants action returned a result. The requested changes may not have been made.",
        },
      ],
      status: {
        type: "incomplete",
        reason: "error",
      },
      metadata: {
        custom: {
          activityTrail: [
            {
              label: "Running present design variants",
              tool: "present-design-variants",
            },
          ],
          runError: {
            message:
              "The agent stopped before the present design variants action returned a result. The requested changes may not have been made.",
            details: "interrupted_actions: present-design-variants",
            errorCode: "action_not_started",
            recoverable: true,
          },
        },
      },
    });
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:run-error",
        detail: expect.objectContaining({
          errorCode: "action_not_started",
          tabId: "tab-unfinished-tool",
        }),
      }),
    );
  });

  it("clears visible activity when the server clears a corrective draft", async () => {
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

    const results = await drain(
      readSSEStream(
        eventStream([
          { type: "text", text: "Rejected draft" },
          {
            type: "activity",
            label: "Preparing data-source-status action",
            tool: "data-source-status",
          },
          { type: "clear" },
          { type: "done" },
        ]),
        [],
        { value: 0 },
        "tab-clear",
      ),
    );

    expect(results).toContainEqual({ content: [] });
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:activity-clear",
        detail: { tabId: "tab-clear" },
      }),
    );
  });

  it("keeps completed tool calls when clearing rejected draft text", async () => {
    const results = await drain(
      readSSEStream(
        eventStream([
          { type: "tool_start", tool: "query", input: { sql: "select 1" } },
          { type: "tool_done", tool: "query", result: "1" },
          { type: "text", text: "Rejected draft" },
          { type: "clear" },
          { type: "text", text: "Corrected answer" },
          { type: "done" },
        ]),
        [],
        { value: 0 },
      ),
    );

    expect(results).toContainEqual({
      content: [
        expect.objectContaining({
          type: "tool-call",
          toolName: "query",
          result: "1",
        }),
      ],
    });
    expect(results.at(-1)).toEqual({
      content: [
        expect.objectContaining({
          type: "tool-call",
          toolName: "query",
          result: "1",
        }),
        { type: "text", text: "Corrected answer" },
      ],
    });
  });

  it("keeps materialized pending tool calls across clear events", async () => {
    const results = await drain(
      readSSEStream(
        eventStream([
          { type: "tool_start", tool: "query", input: { sql: "select 1" } },
          { type: "clear" },
          { type: "text", text: "Retrying" },
          { type: "done" },
        ]),
        [],
        { value: 0 },
      ),
    );

    const clearSnapshot = results.find(
      (result) =>
        Array.isArray(result.content) &&
        result.content.some(
          (part) =>
            part?.type === "tool-call" &&
            part.toolName === "query" &&
            !("result" in part),
        ) &&
        !result.content.some((part) => part?.type === "text"),
    );
    expect(clearSnapshot?.content).toEqual([
      expect.objectContaining({
        type: "tool-call",
        toolName: "query",
        args: { sql: "select 1" },
      }),
    ]);
  });

  it("still clears ephemeral activity placeholders on clear events", async () => {
    const results = await drain(
      readSSEStream(
        eventStream([
          {
            type: "activity",
            label: "Preparing query",
            tool: "query",
          },
          { type: "clear" },
          { type: "text", text: "Retrying" },
          { type: "done" },
        ]),
        [],
        { value: 0 },
      ),
    );

    expect(results.at(-1)).toEqual({
      content: [{ type: "text", text: "Retrying" }],
    });
  });

  it("dispatches visible activity for tool starts", async () => {
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

    const results = await drain(
      readSSEStream(
        eventStream([
          {
            type: "tool_start",
            tool: "create-document",
            input: { title: "Plan" },
          },
          { type: "done" },
        ]),
        [],
        { value: 0 },
        "tab-tool-start",
      ),
    );

    expect(results[0]).toEqual({
      content: [
        expect.objectContaining({
          type: "tool-call",
          toolName: "create-document",
        }),
      ],
      metadata: {
        custom: {
          activityTrail: [
            {
              label: "Running create document",
              tool: "create-document",
            },
          ],
        },
      },
    });
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:activity",
        detail: {
          label: "Running create document",
          tool: "create-document",
          tabId: "tab-tool-start",
        },
      }),
    );
  });

  it("surfaces bare 'builder_gateway_error' instead of looping auto-continuation", async () => {
    // Production-agent retries this synchronously up to MAX_RETRIES inside
    // the run before emitting `error`. By the time the client sees this
    // event the server has given up — auto-continuing on top of that just
    // sends another POST that hits the same wall, which is what produced
    // the 32-continuation regenerate-loop user-visible bug.
    const iter = readSSEStream(
      eventStream([
        {
          type: "error",
          error:
            'Gateway error (no detail; raw event: {"type":"stop","reason":"error","requestId":"req_1"})',
          errorCode: "builder_gateway_error",
        },
      ]),
      [],
      { value: 0 },
      "tab-gateway",
    )[Symbol.asyncIterator]();

    const first = await iter.next();
    expect(first.done).toBe(false);
    expect(first.value?.status).toEqual({
      type: "incomplete",
      reason: "error",
    });
    const second = await iter.next();
    expect(second.done).toBe(true);
  });

  it("settles pending tool calls when a terminal stream error arrives", async () => {
    const results = await drain(
      readSSEStream(
        eventStream([
          {
            type: "tool_start",
            tool: "save-analysis",
            input: { id: "plane-analysis" },
          },
          {
            type: "error",
            error: "Gateway error",
            errorCode: "builder_gateway_error",
          },
        ]),
        [],
        { value: 0 },
        "tab-terminal-error",
      ),
    );

    const last = results.at(-1) as any;
    const tool = last.content.find(
      (part: any) =>
        part.type === "tool-call" && part.toolName === "save-analysis",
    );
    expect(tool?.result).toBe(
      "Interrupted before this tool returned a result.",
    );
    expect(last.status).toEqual({ type: "incomplete", reason: "error" });
  });

  it("surfaces daily gateway caps instead of looping auto-continuation", async () => {
    const iter = readSSEStream(
      eventStream([
        {
          type: "error",
          error:
            "Daily gateway request cap reached (cap: 5000). Please try again tomorrow.",
          errorCode: "rate_limit_exceeded",
        },
      ]),
      [],
      { value: 0 },
      "tab-gateway-cap",
    )[Symbol.asyncIterator]();

    const first = await iter.next();
    expect(first.done).toBe(false);
    expect(first.value?.status).toEqual({
      type: "incomplete",
      reason: "error",
    });
    const second = await iter.next();
    expect(second.done).toBe(true);
  });

  it("auto-continues Builder gateway network errors", async () => {
    const err = await readSSEStream(
      eventStream([
        {
          type: "error",
          error: "Builder gateway network error: socket hang up",
          errorCode: "builder_gateway_network_error",
        },
      ]),
      [],
      { value: 0 },
      "tab-gateway-network",
    )
      [Symbol.asyncIterator]()
      .next()
      .then(
        () => undefined,
        (caught) => caught,
      );

    expect(err).toBeInstanceOf(AgentAutoContinueSignal);
    expect((err as AgentAutoContinueSignal).reason).toBe("stream_ended");
    expect((err as AgentAutoContinueSignal).errorInfo).toMatchObject({
      errorCode: "builder_gateway_network_error",
      message: "Builder gateway network error: socket hang up",
      recoverable: true,
    });
  });

  it("surfaces run_budget_exhausted as a loud terminal error without auto-continuing", async () => {
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

    const giveUpMessage =
      "I ran out of time before finishing this step. " +
      "I stopped rather than leave things half-done — nothing was partially saved by me here. " +
      "Please retry, ideally as a single bulk action.";

    // Must NOT throw AgentAutoContinueSignal — it must terminate with a result.
    const results = await drain(
      readSSEStream(
        eventStream([
          {
            type: "error",
            error: giveUpMessage,
            errorCode: "run_budget_exhausted",
            recoverable: true,
          },
        ]),
        [],
        { value: 0 },
        "tab-budget",
      ),
    );

    const terminal = results.at(-1) as
      | {
          status?: { type: string; reason: string };
          metadata?: { custom?: { runError?: { recoverable?: boolean } } };
        }
      | undefined;
    expect(terminal?.status).toEqual({ type: "incomplete", reason: "error" });
    // recoverable:true survives so the recovery banner reads
    // "stopped before finishing".
    expect(terminal?.metadata?.custom?.runError?.recoverable).toBe(true);

    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:run-error",
        detail: expect.objectContaining({
          message: giveUpMessage,
          errorCode: "run_budget_exhausted",
          recoverable: true,
        }),
      }),
    );
  });
});

describe("SSE event processor tool id matching", () => {
  it("assigns tool_done result to the correct call when two same-name calls run in parallel and events carry ids", async () => {
    const content: any[] = [];
    const results = await drain(
      readSSEStream(
        eventStream([
          // Two parallel "search" calls start at the same time
          {
            type: "tool_start",
            tool: "search",
            id: "call-1",
            input: { q: "dogs" },
          },
          {
            type: "tool_start",
            tool: "search",
            id: "call-2",
            input: { q: "cats" },
          },
          // Results arrive in reverse order
          {
            type: "tool_done",
            tool: "search",
            id: "call-2",
            result: "cats found",
          },
          {
            type: "tool_done",
            tool: "search",
            id: "call-1",
            result: "dogs found",
          },
          { type: "done" },
        ]),
        content,
        { value: 0 },
        undefined,
      ),
    );

    // After all events, find the two tool calls and verify results are correctly paired
    const lastResult = results[results.length - 1];
    const parts = lastResult?.content ?? [];
    const call1 = parts.find(
      (p: any) => p.type === "tool-call" && p.toolCallId === "call-1",
    );
    const call2 = parts.find(
      (p: any) => p.type === "tool-call" && p.toolCallId === "call-2",
    );
    expect(call1?.result).toBe("dogs found");
    expect(call2?.result).toBe("cats found");
  });

  it("falls back to name matching when events lack an id", async () => {
    const content: any[] = [];
    const results = await drain(
      readSSEStream(
        eventStream([
          // No id on events — legacy server build
          { type: "tool_start", tool: "lookup", input: { key: "a" } },
          { type: "tool_done", tool: "lookup", result: "value-a" },
          { type: "done" },
        ]),
        content,
        { value: 0 },
        undefined,
      ),
    );

    const lastResult = results[results.length - 1];
    const part = lastResult?.content?.find(
      (p: any) => p.type === "tool-call" && p.toolName === "lookup",
    );
    expect(part?.result).toBe("value-a");
  });

  it("stores the server-assigned id as the toolCallId when the start event carries one", async () => {
    const content: any[] = [];
    await drain(
      readSSEStream(
        eventStream([
          { type: "tool_start", tool: "fetch", id: "srv-99", input: {} },
          { type: "done" },
        ]),
        content,
        { value: 0 },
        undefined,
      ),
    );

    const part = content.find(
      (p: any) => p.type === "tool-call" && p.toolName === "fetch",
    );
    expect(part?.toolCallId).toBe("srv-99");
  });

  it("attaches approval metadata to the matching tool-call on approval_required", async () => {
    // The server emits tool_start, then approval_required (the gate paused the
    // turn), then a paused tool_done — the call never executed.
    const content: any[] = [];
    await drain(
      readSSEStream(
        eventStream([
          {
            type: "tool_start",
            tool: "send-email",
            id: "approve-1",
            input: { to: "a@b.com" },
          },
          {
            type: "approval_required",
            tool: "send-email",
            id: "approve-1",
            approvalKey: 'send-email:{"to":"a@b.com"}',
            input: { to: "a@b.com" },
          },
          {
            type: "tool_done",
            tool: "send-email",
            id: "approve-1",
            result: "Awaiting human approval — did NOT execute.",
          },
          { type: "done" },
        ]),
        content,
        { value: 0 },
        undefined,
      ),
    );

    const part = content.find(
      (p: any) => p.type === "tool-call" && p.toolCallId === "approve-1",
    );
    expect(part?.approval).toEqual({
      approvalKey: 'send-email:{"to":"a@b.com"}',
    });
  });
});

describe("SSE event processor activity-label clearing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stubWindow = () => {
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
    return dispatchEvent;
  };

  it("clears the running activity label when a tool finishes", async () => {
    const dispatchEvent = stubWindow();
    await drain(
      readSSEStream(
        eventStream([
          { type: "tool_start", tool: "generate-image", input: {} },
          { type: "tool_done", tool: "generate-image", result: "ok" },
          { type: "done" },
        ]),
        [],
        { value: 0 },
        "tab-clear-tool",
      ),
    );
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:activity-clear",
        detail: { tabId: "tab-clear-tool" },
      }),
    );
  });

  it("clears the running activity label when visible text streams", async () => {
    const dispatchEvent = stubWindow();
    await drain(
      readSSEStream(
        eventStream([
          { type: "text", text: "Here is your answer." },
          { type: "done" },
        ]),
        [],
        { value: 0 },
        "tab-clear-text",
      ),
    );
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:activity-clear",
        detail: { tabId: "tab-clear-text" },
      }),
    );
  });
});

describe("journal-recovery tool replay coalescing", () => {
  function eventsStream(events: object[]): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const ev of events) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
        }
        controller.close();
      },
    });
  }

  async function contentAfter(events: object[]) {
    const content: any[] = [];
    await readSSEStreamRaw(
      eventsStream([...events, { type: "done" }]),
      content,
      { value: 0 },
      undefined,
      () => {},
    ).catch(() => {
      // Terminal signals from the fixture stream are irrelevant here — the
      // assertions inspect the mutated content array.
    });
    return content;
  }

  const JOURNAL_MARKER =
    "(Already completed in an earlier interrupted attempt - not re-run to avoid a duplicate side effect.)\n\nreal result";
  const LEDGER_MARKER =
    "(Recovered from prior interrupted chunk — action already completed.)\n\nreal result";

  it("drops a journal-replayed pair when the original call already completed", async () => {
    const content = await contentAfter([
      { type: "tool_start", tool: "edit-screen", input: { a: 1 }, id: "srv_1" },
      {
        type: "tool_done",
        tool: "edit-screen",
        result: "real result",
        id: "srv_1",
      },
      // Continuation chunk replays the same call via the tool-call journal
      // (id-less re-emit with the marker result).
      { type: "tool_start", tool: "edit-screen", input: { a: 1 } },
      { type: "tool_done", tool: "edit-screen", result: JOURNAL_MARKER },
    ]);

    const toolCards = content.filter((p) => p.type === "tool-call");
    expect(toolCards).toHaveLength(1);
    expect(toolCards[0].result).toBe("real result");
  });

  it("resolves an interrupted spinner with the ledger-recovered result and removes the replay artifact", async () => {
    const content = await contentAfter([
      // Original call was interrupted: tool_start with no tool_done.
      { type: "tool_start", tool: "edit-screen", input: { a: 1 }, id: "srv_1" },
      // Next chunk replays it; the id-less tool_done name-matches the original
      // pending card, leaving the replay's own start as a stuck spinner.
      { type: "tool_start", tool: "edit-screen", input: { a: 1 } },
      { type: "tool_done", tool: "edit-screen", result: LEDGER_MARKER },
    ]);

    const toolCards = content.filter((p) => p.type === "tool-call");
    expect(toolCards).toHaveLength(1);
    expect(toolCards[0].result).toBe(LEDGER_MARKER);
    expect(toolCards[0].toolCallId).toBe("srv_1");
  });

  it("keeps genuinely repeated identical calls that are not journal replays", async () => {
    const content = await contentAfter([
      {
        type: "tool_start",
        tool: "db-query",
        input: { sql: "select 1" },
        id: "srv_1",
      },
      { type: "tool_done", tool: "db-query", result: "row A", id: "srv_1" },
      { type: "text", text: "checking again" },
      {
        type: "tool_start",
        tool: "db-query",
        input: { sql: "select 1" },
        id: "srv_2",
      },
      { type: "tool_done", tool: "db-query", result: "row B", id: "srv_2" },
    ]);

    const toolCards = content.filter((p) => p.type === "tool-call");
    expect(toolCards).toHaveLength(2);
    expect(toolCards.map((p) => p.result)).toEqual(["row A", "row B"]);
  });
});

describe("SSE thinking / reasoning events", () => {
  function eventsStream(events: object[]): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const ev of events) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
        }
        controller.close();
      },
    });
  }

  it("coalesces thinking deltas into a single reasoning part", async () => {
    const content: any[] = [];
    await readSSEStreamRaw(
      eventsStream([
        { type: "thinking", text: "First, " },
        { type: "reasoning", text: "check the schema." },
        { type: "text", text: "Here is the answer." },
        { type: "done" },
      ]),
      content,
      { value: 0 },
      undefined,
      () => {},
    ).catch(() => {});

    expect(content).toEqual([
      { type: "reasoning", text: "First, check the schema." },
      { type: "text", text: "Here is the answer." },
    ]);
  });

  it("clears in-flight reasoning on clear events", async () => {
    const content: any[] = [];
    await readSSEStreamRaw(
      eventsStream([
        { type: "thinking", text: "draft thought" },
        { type: "clear" },
        { type: "text", text: "retry" },
        { type: "done" },
      ]),
      content,
      { value: 0 },
      undefined,
      () => {},
    ).catch(() => {});

    expect(content).toEqual([{ type: "text", text: "retry" }]);
  });
});
