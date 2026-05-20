import { afterEach, describe, expect, it } from "vitest";
import {
  __clearReservedJobs,
  findReservedJob,
  registerReservedJob,
} from "./reserved.js";

afterEach(() => __clearReservedJobs());

describe("reserved-job registry", () => {
  it("matches an exact slug", () => {
    registerReservedJob({ name: "send-due-steps", reason: "native cron" });
    expect(findReservedJob("send-due-steps")?.reason).toBe("native cron");
    expect(findReservedJob("send-due-stepss")).toBeUndefined();
  });

  it("matches a RegExp pattern", () => {
    registerReservedJob({ name: /^sequencer-/i, reason: "owned by sequencer" });
    expect(findReservedJob("sequencer-send-due-steps")?.reason).toBe(
      "owned by sequencer",
    );
    expect(findReservedJob("Sequencer-Watchdog")?.reason).toBe(
      "owned by sequencer",
    );
    expect(findReservedJob("daily-digest")).toBeUndefined();
  });

  it("returns the first match when multiple reservations overlap", () => {
    registerReservedJob({ name: "send-due-steps", reason: "first" });
    registerReservedJob({ name: /^send-/, reason: "second" });
    expect(findReservedJob("send-due-steps")?.reason).toBe("first");
  });
});
