import { describe, expect, it } from "vitest";

import action from "./import-design-project.js";

describe("import-design-project schema", () => {
  it("requires a design project", () => {
    expect(action.schema.safeParse({}).success).toBe(false);
    expect(action.schema.safeParse({ designId: "design_123" }).success).toBe(
      true,
      // oracle-change: Design Systems removed from Design; its assertions no longer apply
    );
  });
});
