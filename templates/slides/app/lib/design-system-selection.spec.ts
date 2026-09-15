import { describe, expect, it } from "vitest";

import {
  isDesignSystemSelectable,
  resolveSelectableDesignSystemId,
} from "./design-system-selection";

describe("isDesignSystemSelectable", () => {
  it("allows a ready design system", () => {
    expect(isDesignSystemSelectable({ indexingStatus: "ready" })).toBe(true);
  });

  it("allows a design system with no reported status (locally authored)", () => {
    expect(isDesignSystemSelectable({})).toBe(true);
  });

  it("blocks a design system that is still indexing", () => {
    expect(isDesignSystemSelectable({ indexingStatus: "indexing" })).toBe(
      false,
    );
  });

  it("blocks a design system whose indexing failed", () => {
    expect(isDesignSystemSelectable({ indexingStatus: "unavailable" })).toBe(
      false,
    );
  });
});

describe("resolveSelectableDesignSystemId", () => {
  const designSystems = [
    { id: "ready-1", indexingStatus: "ready" as const },
    { id: "indexing-1", indexingStatus: "indexing" as const },
    { id: "unavailable-1", indexingStatus: "unavailable" as const },
  ];

  it("returns null when no candidate id is given", () => {
    expect(resolveSelectableDesignSystemId(designSystems, null)).toBeNull();
    expect(
      resolveSelectableDesignSystemId(designSystems, undefined),
    ).toBeNull();
  });

  it("returns null when the candidate id is not found", () => {
    expect(
      resolveSelectableDesignSystemId(designSystems, "missing"),
    ).toBeNull();
  });

  it("returns the candidate id when it is selectable", () => {
    expect(resolveSelectableDesignSystemId(designSystems, "ready-1")).toBe(
      "ready-1",
    );
  });

  it("drops a candidate that is still indexing instead of pre-selecting it", () => {
    expect(
      resolveSelectableDesignSystemId(designSystems, "indexing-1"),
    ).toBeNull();
  });

  it("drops a candidate whose indexing failed", () => {
    expect(
      resolveSelectableDesignSystemId(designSystems, "unavailable-1"),
    ).toBeNull();
  });
});
