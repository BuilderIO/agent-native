import { describe, expect, it } from "vitest";

import { normalizeCreativeContextState } from "./application-state.js";

describe("normalizeCreativeContextState", () => {
  it("defaults missing state to automatic context", () => {
    expect(normalizeCreativeContextState(null)).toEqual({
      contextMode: "auto",
      currentPackId: null,
      pinnedPackId: null,
    });
  });

  it("clears current and pinned packs when context is off", () => {
    expect(
      normalizeCreativeContextState({
        contextMode: "off",
        currentPackId: "current-pack",
        pinnedPackId: "pinned-pack",
      }),
    ).toEqual({
      contextMode: "off",
      currentPackId: null,
      pinnedPackId: null,
    });
  });

  it("keeps valid pack ids in automatic mode", () => {
    expect(
      normalizeCreativeContextState({
        contextMode: "auto",
        currentPackId: " current-pack ",
        pinnedPackId: "pinned-pack",
      }),
    ).toEqual({
      contextMode: "auto",
      currentPackId: "current-pack",
      pinnedPackId: "pinned-pack",
    });
  });
});
