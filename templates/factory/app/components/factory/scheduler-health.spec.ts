import { describe, expect, it } from "vitest";

import { schedulerView } from "./scheduler-health";

describe("schedulerView", () => {
  it("has nothing to show until the health read answers", () => {
    expect(schedulerView(undefined, null)).toBeNull();
  });

  it("keeps a failed read apart from a scheduler with no heartbeat", () => {
    expect(schedulerView(undefined, new Error("boom"))).toEqual({
      kind: "unreadable",
      message: "boom",
    });
    expect(
      schedulerView({ status: "no-data", lastCheckedAt: null }, null),
    ).toEqual({
      kind: "reported",
      word: "noHeartbeat",
      lastCheckedAt: null,
      lastError: null,
    });
  });

  it("reports the last check and the last error of a scheduler that answered", () => {
    expect(
      schedulerView(
        { status: "error", lastCheckedAt: 1_700_000_000_000, lastError: "x" },
        null,
      ),
    ).toEqual({
      kind: "reported",
      word: "error",
      lastCheckedAt: 1_700_000_000_000,
      lastError: "x",
    });
  });

  it("does not report an empty error string as an error", () => {
    expect(
      schedulerView(
        { status: "healthy", lastCheckedAt: 5, lastError: "" },
        null,
      ),
    ).toMatchObject({ word: "healthy", lastError: null });
  });
});
