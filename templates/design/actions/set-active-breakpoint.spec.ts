import { describe, expect, it } from "vitest";

import action from "./set-active-breakpoint.js";

describe("set-active-breakpoint schema", () => {
  it("accepts a breakpoint id as the new edit scope", () => {
    expect(
      action.schema.safeParse({ designId: "design_1", breakpointId: "bp_1" })
        .success,
    ).toBe(true);
  });

  it("accepts the literal 'auto' to reset to the base scope", () => {
    expect(
      action.schema.safeParse({ designId: "design_1", breakpointId: "auto" })
        .success,
    ).toBe(true);
  });

  it("accepts both explicit responsive edit scopes and defaults to the cascade", () => {
    expect(
      action.schema.parse({ designId: "design_1", breakpointId: "bp_1" })
        .editScope,
    ).toBe("cascade-smaller");
    expect(
      action.schema.safeParse({
        designId: "design_1",
        breakpointId: "bp_1",
        editScope: "only",
      }).success,
    ).toBe(true);
  });

  it("requires both designId and breakpointId", () => {
    expect(action.schema.safeParse({ designId: "design_1" }).success).toBe(
      false,
    );
    expect(action.schema.safeParse({ breakpointId: "auto" }).success).toBe(
      false,
    );
  });
});
