import { describe, expect, it, vi } from "vitest";

import { prepareRewindRecordingStart } from "./rewind-recording-start";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("prepareRewindRecordingStart", () => {
  it("shows the countdown immediately and activates only after both settle", async () => {
    const events: string[] = [];
    const prepareGate = deferred();
    const countdownGate = deferred();

    const startPromise = prepareRewindRecordingStart({
      async prepare() {
        events.push("prepare-start");
        await prepareGate.promise;
        events.push("prepare-done");
        return "prepared";
      },
      async countdown() {
        events.push("countdown-start");
        await countdownGate.promise;
        events.push("countdown-done");
      },
      cancelCountdown() {
        events.push("cancel-countdown");
      },
      async activate(prepared) {
        events.push(`activate:${prepared}`);
        return "started";
      },
      onActivated() {
        events.push("acknowledged");
      },
    });

    await Promise.resolve();
    expect(events).toEqual(["prepare-start", "countdown-start"]);

    // Countdown reaching zero must not activate while prepare is pending.
    countdownGate.resolve();
    await Promise.resolve();
    expect(events).not.toContain("activate:prepared");

    prepareGate.resolve();
    await expect(startPromise).resolves.toBe("started");
    expect(events).toEqual([
      "prepare-start",
      "countdown-start",
      "countdown-done",
      "prepare-done",
      "activate:prepared",
      "acknowledged",
    ]);
  });

  it("waits out a prepare that outlasts the countdown before activating", async () => {
    const events: string[] = [];
    const prepareGate = deferred();

    const startPromise = prepareRewindRecordingStart({
      async prepare() {
        await prepareGate.promise;
        events.push("prepare-done");
        return "prepared";
      },
      async countdown() {
        events.push("countdown-done");
      },
      cancelCountdown() {
        events.push("cancel-countdown");
      },
      async activate() {
        events.push("activate");
        return "started";
      },
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["countdown-done"]);

    prepareGate.resolve();
    await expect(startPromise).resolves.toBe("started");
    expect(events).toEqual(["countdown-done", "prepare-done", "activate"]);
  });

  it("cancels a live countdown when prepare fails, then surfaces the prepare error", async () => {
    const events: string[] = [];
    const countdownGate = deferred();

    await expect(
      prepareRewindRecordingStart({
        async prepare() {
          throw new Error("create recording failed");
        },
        async countdown() {
          events.push("countdown-start");
          await countdownGate.promise;
        },
        cancelCountdown() {
          events.push("cancel-countdown");
          countdownGate.reject(new Error("countdown cancelled"));
        },
        async activate() {
          events.push("activate");
          return "started";
        },
      }),
    ).rejects.toThrow("create recording failed");

    expect(events).toEqual(["countdown-start", "cancel-countdown"]);
  });

  it("surfaces a countdown cancel after prepare settles, without activating", async () => {
    const events: string[] = [];
    const prepareGate = deferred();

    const startPromise = prepareRewindRecordingStart({
      async prepare() {
        await prepareGate.promise;
        events.push("prepare-done");
        return "prepared";
      },
      async countdown() {
        throw new Error("Recording cancelled during countdown");
      },
      cancelCountdown() {
        events.push("cancel-countdown");
      },
      async activate() {
        events.push("activate");
        return "started";
      },
    });

    // The cancel must wait for prepare to settle so backend cleanup never
    // races an in-flight prepare.
    prepareGate.resolve();
    await expect(startPromise).rejects.toThrow(
      "Recording cancelled during countdown",
    );
    expect(events).toEqual(["prepare-done"]);
  });

  it("does not acknowledge a start when activation fails", async () => {
    const onActivated = vi.fn();

    await expect(
      prepareRewindRecordingStart({
        async prepare() {
          return undefined;
        },
        async countdown() {},
        cancelCountdown() {},
        async activate() {
          throw new Error("sink unavailable");
        },
        onActivated,
      }),
    ).rejects.toThrow("sink unavailable");

    expect(onActivated).not.toHaveBeenCalled();
  });
});
