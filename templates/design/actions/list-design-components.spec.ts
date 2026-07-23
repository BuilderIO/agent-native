import { describe, expect, it } from "vitest";

import action from "./list-design-components.js";

describe("list-design-components schema", () => {
  it("accepts the minimal designId payload", () => {
    expect(action.schema.safeParse({ designId: "design_1" }).success).toBe(
      true,
    );
  });

  it("accepts an optional excludeName", () => {
    const parsed = action.schema.safeParse({
      designId: "design_1",
      excludeName: "PrimaryButton",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.excludeName).toBe("PrimaryButton");
  });

  it("rejects a payload missing designId", () => {
    expect(action.schema.safeParse({}).success).toBe(false);
  });

  it("is read-only over GET", () => {
    expect(action.readOnly).toBe(true);
    expect(action.http).toMatchObject({ method: "GET" });
  });
});
