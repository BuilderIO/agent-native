import { describe, expect, it, vi } from "vitest";

import { prepareRewindRecordingStart } from "./rewind-recording-start";

describe("prepareRewindRecordingStart", () => {
  it("finishes native and server preparation before showing the countdown", async () => {
    const events: string[] = [];
    const result = await prepareRewindRecordingStart({
      async prepare() {
        events.push("prepare-start");
        await Promise.resolve();
        events.push("prepare-done");
        return "prepared";
      },
      async countdown() {
        events.push("countdown");
      },
      async activate(prepared) {
        events.push(`activate:${prepared}`);
        return "started";
      },
      onActivated() {
        events.push("acknowledged");
      },
    });

    expect(result).toBe("started");
    expect(events).toEqual([
      "prepare-start",
      "prepare-done",
      "countdown",
      "activate:prepared",
      "acknowledged",
    ]);
  });

  it("does not acknowledge a start when activation fails", async () => {
    const onActivated = vi.fn();

    await expect(
      prepareRewindRecordingStart({
        async prepare() {
          return undefined;
        },
        async countdown() {},
        async activate() {
          throw new Error("sink unavailable");
        },
        onActivated,
      }),
    ).rejects.toThrow("sink unavailable");

    expect(onActivated).not.toHaveBeenCalled();
  });
});
