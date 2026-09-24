import { beforeEach, describe, expect, it, vi } from "vitest";

const { getTaskCardFieldIds } = vi.hoisted(() => ({
  getTaskCardFieldIds: vi.fn(),
}));

vi.mock("../server/user-config/store.js", () => ({
  getTaskCardFieldIds,
}));

vi.mock("../server/custom-fields/store.js", () => ({
  requireUserEmail: (email: string | undefined) => {
    if (!email) throw new Error("Authentication required.");
    return email;
  },
}));

import listVisibleTaskFieldsAction, {
  listVisibleTaskFieldsSchema,
} from "./list-visible-task-fields.js";

describe("list-visible-task-fields", () => {
  beforeEach(() => {
    getTaskCardFieldIds.mockReset();
  });

  describe("schema", () => {
    it("accepts an empty object", () => {
      expect(listVisibleTaskFieldsSchema.parse({})).toEqual({});
    });
  });

  describe("run", () => {
    it("returns visible task card field ids for the current user", async () => {
      getTaskCardFieldIds.mockResolvedValue(["fld-priority", "fld-due"]);

      const result = await listVisibleTaskFieldsAction.run(
        {},
        { userEmail: "alice@example.com", caller: "cli" },
      );

      expect(getTaskCardFieldIds).toHaveBeenCalledWith({
        ownerEmail: "alice@example.com",
      });
      expect(result).toEqual({ fieldIds: ["fld-priority", "fld-due"] });
    });
  });
});
