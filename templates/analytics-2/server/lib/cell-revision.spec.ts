import { describe, expect, it } from "vitest";

import { isCellRevisionCurrent } from "./cell-revision.js";

const stored = { updatedAt: "2026-11-15T12:00:00.000Z" };

describe("isCellRevisionCurrent", () => {
  it("accepts a save that names no revision", () => {
    expect(isCellRevisionCurrent(stored, undefined)).toBe(true);
  });

  it("accepts a save that names the stored revision", () => {
    expect(isCellRevisionCurrent(stored, "2026-11-15T12:00:00.000Z")).toBe(
      true,
    );
  });

  it("refuses a save whose revision was overtaken by another change", () => {
    expect(isCellRevisionCurrent(stored, "2026-11-15T11:00:00.000Z")).toBe(
      false,
    );
  });
});
