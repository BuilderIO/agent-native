import { describe, expect, it } from "vitest";

import action from "./import-design-project.js";

describe("import-design-project schema", () => {
  it("accepts either a design project or an existing design system source", () => {
    expect(action.schema.safeParse({}).success).toBe(false);
    expect(action.schema.safeParse({ designId: "design_123" }).success).toBe(
      true,
    );
    expect(
      action.schema.safeParse({ designSystemId: "system_123" }).success,
    ).toBe(true);
  });
});
