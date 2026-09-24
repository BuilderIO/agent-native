import { describe, expect, it } from "vitest";

import action from "./update-breakpoint.js";

describe("update-breakpoint schema", () => {
  const base = {
    designId: "design_1",
    breakpointId: "bp_1",
    widthPx: 375,
  };

  it("accepts a valid width update with an optional label", () => {
    expect(action.schema.safeParse(base).success).toBe(true);
    expect(action.schema.safeParse({ ...base, label: "Mobile" }).success).toBe(
      true,
    );
  });

  it("requires the design, breakpoint id, and bounded integer width", () => {
    expect(
      action.schema.safeParse({ ...base, designId: undefined }).success,
    ).toBe(false);
    expect(
      action.schema.safeParse({ ...base, breakpointId: undefined }).success,
    ).toBe(false);
    expect(action.schema.safeParse({ ...base, widthPx: 319 }).success).toBe(
      false,
    );
    expect(action.schema.safeParse({ ...base, widthPx: 3841 }).success).toBe(
      false,
    );
    expect(action.schema.safeParse({ ...base, widthPx: 375.5 }).success).toBe(
      false,
    );
  });

  it("rejects an empty replacement label", () => {
    expect(action.schema.safeParse({ ...base, label: "" }).success).toBe(false);
  });
});
