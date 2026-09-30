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
  it("prepares before countdown and plays the cue before activation", async () => {
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
    expect(events).toEqual(["prepare-start"]);

    prepareGate.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual([
      "prepare-start",
      "prepare-done",
      "countdown-start",
    ]);

    countdownGate.resolve();
    await expect(startPromise).resolves.toBe("started");
    expect(events).toEqual([
      "prepare-start",
      "prepare-done",
      "countdown-start",
      "countdown-done",
      "play-cue",
      "activate:prepared",
    ]);
  });

  it("does not start the countdown while preparation is pending", async () => {
    const events: string[] = [];
    const prepareGate = deferred();

    const startPromise = prepareRewindRecordingStart({
      async prepare() {
        await prepareGate.promise;
        events.push("prepare-done");
        return "prepared";
      },
      async countdown() {
        events.push("countdown");
      },
      async activate() {
        events.push("activate");
        return "started";
      },
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual([]);

    prepareGate.resolve();
    await expect(startPromise).resolves.toBe("started");
    expect(events).toEqual(["prepare-done", "countdown", "activate"]);
  });

  it("does not start a countdown when preparation fails", async () => {
    const events: string[] = [];

    await expect(
      prepareRewindRecordingStart({
        async prepare() {
          throw new Error("create recording failed");
        },
        async countdown() {
          events.push("countdown");
        },
        async activate() {
          events.push("activate");
          return "started";
        },
      }),
    ).rejects.toThrow("create recording failed");

    expect(events).toEqual([]);
  });

  it("surfaces a countdown cancel without activating", async () => {
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
      async activate() {
        events.push("activate");
        return "started";
      },
    });

    prepareGate.resolve();
    await expect(startPromise).rejects.toThrow(
      "Recording cancelled during countdown",
    );
    expect(events).toEqual(["prepare-done"]);
  });

  it("surfaces activation failure after playing the cue", async () => {
    const events: string[] = [];

    await expect(
      prepareRewindRecordingStart({
        async prepare() {
          return undefined;
        },
        async countdown() {},
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
