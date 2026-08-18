import { describe, expect, it } from "vitest";

import action from "./get-crm-automation-recipe.js";

describe("get-crm-automation-recipe schema", () => {
  it("requires one bounded CRM record selection", () => {
    expect(action.schema.safeParse({ recordId: "record-1" }).success).toBe(
      true,
    );
    expect(action.schema.safeParse({}).success).toBe(false);
    expect(action.schema.safeParse({ recordId: "x".repeat(129) }).success).toBe(
      false,
    );
  });
});
