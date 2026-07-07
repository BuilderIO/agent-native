import { describe, expect, it } from "vitest";

import action from "./add-breakpoint.js";

describe("add-breakpoint schema", () => {
  const base = { designId: "design_1", label: "Tablet", widthPx: 810 };

  it("accepts a Framer-style preset width", () => {
    expect(action.schema.safeParse(base).success).toBe(true);
    expect(
      action.schema.safeParse({ ...base, label: "Phone", widthPx: 390 })
        .success,
    ).toBe(true);
    expect(
      action.schema.safeParse({ ...base, label: "Desktop", widthPx: 1200 })
        .success,
    ).toBe(true);
  });

  it("requires designId and a non-empty label", () => {
    expect(
      action.schema.safeParse({ label: "Tablet", widthPx: 810 }).success,
    ).toBe(false);
    expect(action.schema.safeParse({ ...base, label: "" }).success).toBe(false);
  });

  it("bounds widthPx to a sane device range (320-3840)", () => {
    expect(action.schema.safeParse({ ...base, widthPx: 319 }).success).toBe(
      false,
    );
    expect(action.schema.safeParse({ ...base, widthPx: 320 }).success).toBe(
      true,
    );
    expect(action.schema.safeParse({ ...base, widthPx: 3840 }).success).toBe(
      true,
    );
    expect(action.schema.safeParse({ ...base, widthPx: 3841 }).success).toBe(
      false,
    );
    expect(action.schema.safeParse({ ...base, widthPx: 810.5 }).success).toBe(
      false,
    );
  });

  it("accepts an optional pre-generated id", () => {
    expect(action.schema.safeParse({ ...base, id: "bp_custom" }).success).toBe(
      true,
    );
  });
});
