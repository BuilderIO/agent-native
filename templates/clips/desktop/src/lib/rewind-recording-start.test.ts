import { describe, expect, it } from "vitest";

import { prepareRewindRecordingStart } from "./rewind-recording-start";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("prepareRewindRecordingStart", () => {
  it("runs preparation with the countdown and activates after both", async () => {
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
      async beforeActivate() {
        events.push("play-cue");
      },
      async activate(prepared) {
        events.push(`activate:${prepared}`);
        return "started";
      },
    });

    await Promise.resolve();
    expect(events).toEqual(["prepare-start", "countdown-start"]);

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
      "play-cue",
      "activate:prepared",
    ]);
  });

  it("cancels a pending countdown when preparation fails", async () => {
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
          countdownGate.resolve();
        },
        async activate() {
          events.push("activate");
          return "started";
        },
      }),
    ).rejects.toThrow("create recording failed");

    expect(events).toEqual(["countdown-start", "cancel-countdown"]);
  });

  it("surfaces countdown cancellation without waiting for preparation", async () => {
    const events: string[] = [];
    const prepareGate = deferred();

    await expect(
      prepareRewindRecordingStart({
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
      }),
    ).rejects.toThrow("Recording cancelled during countdown");
    expect(events).toEqual(["cancel-countdown"]);

    prepareGate.resolve();
    await Promise.resolve();
    expect(events).toEqual(["cancel-countdown", "prepare-done"]);
  });

  it("surfaces activation failure after playing the cue", async () => {
    const events: string[] = [];

    await expect(
      prepareRewindRecordingStart({
        async prepare() {
          return undefined;
        },
        async countdown() {},
        cancelCountdown() {},
        async beforeActivate() {
          events.push("cue");
        },
        async activate() {
          events.push("activate");
          throw new Error("sink unavailable");
        },
      }),
    ).rejects.toThrow("sink unavailable");

    expect(events).toEqual(["cue", "activate"]);
  });
});
