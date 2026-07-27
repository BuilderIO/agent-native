import { describe, expect, it } from "vitest";

import { pathFromCommand, stateFromLocation } from "./use-navigation-state";

describe("Clips shared navigation", () => {
  it("describes the shared-with-me route to the agent", () => {
    expect(stateFromLocation("/shared", "")).toEqual({ view: "shared" });
  });

  it("maps agent navigation commands to the shared-with-me route", () => {
    expect(pathFromCommand({ view: "shared" })).toBe("/shared");
  });
});
