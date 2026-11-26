import {
  CaptureStartAbortedError,
  CaptureTeardownUnconfirmedError,
  type CaptureStartGate,
} from "@shared/capture-host-runner";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  abortable,
  discardAgentTake,
  skippableDelay,
  startGatedAgentTake,
  type AgentTakeSteps,
} from "./agent-take";

afterEach(() => {
  vi.useRealTimers();
});

function recordedSteps(
  order: string[],
): AgentTakeSteps<{ startedAtMs: number }> {
  return {
    arm: vi.fn(async () => {
      order.push("arm");
      return { recordingId: "clip-1", startDelayMs: 4_000 };
    }),
    countdown: vi.fn(async () => {
      order.push("countdown");
    }),
    begin: vi.fn(async () => {
      order.push("begin");
    }),
    waitForReady: vi.fn(async () => {
      order.push("ready");
      return { startedAtMs: 42 };
    }),
    tearDown: vi.fn(async () => {
      order.push("tearDown");
    }),
  };
}

function gateFrom(confirmBegin: () => Promise<void>, order: string[]) {
  return {
    confirmBegin: vi.fn(async () => {
      order.push("confirm");
      await confirmBegin();
    }),
  } satisfies CaptureStartGate;
}

describe("gated agent takes", () => {
  it("begins the recorder only after its capture host confirms", async () => {
    const order: string[] = [];
    const steps = recordedSteps(order);

    const take = await startGatedAgentTake(
      steps,
      new AbortController().signal,
      gateFrom(async () => undefined, order),
    );

    expect(take).toEqual({ recordingId: "clip-1", ready: { startedAtMs: 42 } });
    expect(order).toEqual(["arm", "countdown", "confirm", "begin", "ready"]);
    expect(steps.countdown).toHaveBeenCalledWith(4_000, expect.anything());
  });

  it("never begins a take its capture host refuses and discards what it set up", async () => {
    const order: string[] = [];
    const steps = recordedSteps(order);
    const refusal = new CaptureStartAbortedError(
      "Capture was stopped before the recorder began.",
    );

    await expect(
      startGatedAgentTake(
        steps,
        new AbortController().signal,
        gateFrom(async () => {
          throw refusal;
        }, order),
      ),
    ).rejects.toBe(refusal);

    expect(steps.begin).not.toHaveBeenCalled();
    expect(order).toEqual(["arm", "countdown", "confirm", "tearDown"]);
  });

  it("discards the take and never asks its host when stopped while arming", async () => {
    const order: string[] = [];
    const steps = recordedSteps(order);
    const controller = new AbortController();
    steps.arm = vi.fn(async () => {
      order.push("arm");
      controller.abort(new Error("Agent capture was stopped."));
      return { recordingId: "clip-1", startDelayMs: 4_000 };
    });
    const gate = gateFrom(async () => undefined, order);

    await expect(
      startGatedAgentTake(steps, controller.signal, gate),
    ).rejects.toThrow("Agent capture was stopped.");

    expect(gate.confirmBegin).not.toHaveBeenCalled();
    expect(order).toEqual(["arm", "tearDown"]);
  });

  it("reports a teardown it could not confirm in place of the start failure", async () => {
    const order: string[] = [];
    const steps = recordedSteps(order);
    steps.begin = vi.fn(async () => {
      throw new Error("Capture video track was lost.");
    });
    const unconfirmed = new CaptureTeardownUnconfirmedError(
      "Recorder teardown is unconfirmed.",
    );
    steps.tearDown = vi.fn(async () => {
      throw unconfirmed;
    });

    await expect(
      startGatedAgentTake(
        steps,
        new AbortController().signal,
        gateFrom(async () => undefined, order),
      ),
    ).rejects.toBe(unconfirmed);
  });
});

describe("abortable agent steps", () => {
  it("settles with the operation when nothing stops it", async () => {
    await expect(
      abortable(Promise.resolve("clip-1"), new AbortController().signal),
    ).resolves.toBe("clip-1");
  });

  it("rejects with the stop reason and hands a late value back for cleanup", async () => {
    const controller = new AbortController();
    let land: (value: string) => void = () => undefined;
    const operation = new Promise<string>((resolve) => {
      land = resolve;
    });
    const onLateValue = vi.fn();

    const settled = abortable(operation, controller.signal, onLateValue);
    controller.abort(new Error("Agent capture was stopped."));
    await expect(settled).rejects.toThrow("Agent capture was stopped.");

    land("clip-late");
    await operation;
    await Promise.resolve();
    expect(onLateValue).toHaveBeenCalledWith("clip-late");
  });

  it("rejects at once when already stopped", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Agent capture was stopped."));

    await expect(
      abortable(Promise.resolve("clip-1"), controller.signal),
    ).rejects.toThrow("Agent capture was stopped.");
  });
});

describe("skippable countdowns", () => {
  it("ends early when skipped", async () => {
    vi.useFakeTimers();
    const countdown = skippableDelay(20_000, new AbortController().signal);
    const ended = vi.fn();
    void countdown.done.then(ended);

    countdown.skip();
    await vi.advanceTimersByTimeAsync(0);

    expect(ended).toHaveBeenCalledOnce();
  });

  it("ends after its delay without a skip", async () => {
    vi.useFakeTimers();
    const countdown = skippableDelay(4_000, new AbortController().signal);
    const ended = vi.fn();
    void countdown.done.then(ended);

    await vi.advanceTimersByTimeAsync(3_999);
    expect(ended).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ended).toHaveBeenCalledOnce();
  });

  it("rejects when the take is stopped during it", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const countdown = skippableDelay(4_000, controller.signal);

    controller.abort(new Error("Agent capture was stopped."));

    await expect(countdown.done).rejects.toThrow("Agent capture was stopped.");
  });
});

describe("discarding agent takes", () => {
  it("succeeds once the recorder stopped and the Clip is gone", async () => {
    await expect(
      discardAgentTake(async () => ({ ok: true, clipRemoved: true })),
    ).resolves.toBeUndefined();
  });

  it("reports a recorder that did not confirm it stopped as unconfirmed teardown", async () => {
    await expect(
      discardAgentTake(async () => ({
        ok: false,
        error: "The recorder did not confirm it stopped within 5 seconds.",
        clipRemoved: true,
      })),
    ).rejects.toBeInstanceOf(CaptureTeardownUnconfirmedError);
  });

  it("fails when the take stopped but its Clip could not be removed", async () => {
    const discarding = discardAgentTake(async () => ({
      ok: true,
      clipRemoved: false,
      clipError: "Clips returned 503.",
    }));

    await expect(discarding).rejects.toThrow(
      "its Clip could not be removed: Clips returned 503.",
    );
    await expect(discarding).rejects.not.toBeInstanceOf(
      CaptureTeardownUnconfirmedError,
    );
  });
});
