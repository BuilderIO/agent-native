import { describe, expect, it } from "vitest";

import action from "./remove-breakpoint.js";

describe("remove-breakpoint schema", () => {
  it("requires designId and breakpointId", () => {
    expect(
      action.schema.safeParse({ designId: "design_1", breakpointId: "bp_1" })
        .success,
    ).toBe(true);
    expect(action.schema.safeParse({ designId: "design_1" }).success).toBe(
      false,
    );
    expect(action.schema.safeParse({ breakpointId: "bp_1" }).success).toBe(
      false,
    );
  });
});
