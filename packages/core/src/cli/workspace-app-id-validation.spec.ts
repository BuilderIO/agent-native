import { describe, expect, it } from "vitest";

import { getBuilderWorkspaceAppIdError } from "./create.js";

describe("add-app id validation (Builder workspace app id)", () => {
  it("accepts ids matching the Builder regex", () => {
    for (const id of ["crm", "a", "my-app-2", "a".repeat(40)]) {
      expect(getBuilderWorkspaceAppIdError(id)).toBeNull();
    }
  });

  it("rejects ids Builder would refuse", () => {
    for (const id of ["1app", "-app", "My-App", "my_app", "a".repeat(41), ""]) {
      expect(getBuilderWorkspaceAppIdError(id)).toMatch(/Invalid app id/);
    }
  });
});
