import { describe, expect, it } from "vitest";

import { pathFromCommand, stateFromLocation } from "./use-navigation-state";

describe("Clips shared navigation", () => {
  it("describes the shared-with-me route to the agent", () => {
    expect(stateFromLocation("/shared", "")).toEqual({ view: "shared" });
  });

  it("maps agent navigation commands to the shared-with-me route", () => {
    expect(pathFromCommand({ view: "shared" })).toBe("/shared");
  });

  it("describes the focused viewer panel and requested timestamp", () => {
    expect(
      stateFromLocation("/r/recording-1", "?panel=transcript&at=42000"),
    ).toEqual({
      view: "recording",
      recordingId: "recording-1",
      panel: "transcript",
      atMs: 42_000,
    });
  });

  it("maps recording context commands to a focused viewer URL", () => {
    expect(
      pathFromCommand({
        view: "recording",
        recordingId: "recording-1",
        panel: "agent",
        atMs: 12_345.6,
      }),
    ).toBe("/r/recording-1?panel=agent&at=12346");
  });
});
