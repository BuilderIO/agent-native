import { beforeEach, describe, expect, it, vi } from "vitest";

const { setTaskCardFieldIds } = vi.hoisted(() => ({
  setTaskCardFieldIds: vi.fn(),
}));

vi.mock("../server/user-config/store.js", () => ({
  setTaskCardFieldIds,
}));

vi.mock("../server/custom-fields/store.js", () => ({
  requireUserEmail: (email: string | undefined) => {
    if (!email) throw new Error("Authentication required.");
    return email;
  },
}));

import updateVisibleTaskFieldsAction, {
  updateVisibleTaskFieldsSchema,
} from "./update-visible-task-fields.js";

describe("update-visible-task-fields", () => {
  beforeEach(() => {
    setTaskCardFieldIds.mockReset();
  });

  describe("schema", () => {
    it("accepts up to three field ids", () => {
      expect(
        updateVisibleTaskFieldsSchema.parse({
          fieldIds: ["fld-1", "fld-2", "fld-3"],
        }),
      ).toEqual({ fieldIds: ["fld-1", "fld-2", "fld-3"] });
    });

    it("accepts an empty array to clear visible fields", () => {
      expect(updateVisibleTaskFieldsSchema.parse({ fieldIds: [] })).toEqual({
        fieldIds: [],
      });
    });

    it("rejects more than three field ids", () => {
      expect(() =>
        updateVisibleTaskFieldsSchema.parse({
          fieldIds: ["fld-1", "fld-2", "fld-3", "fld-4"],
        }),
      ).toThrow();
    });
  });

  describe("run", () => {
    it("replaces visible task fields for the current user", async () => {
      setTaskCardFieldIds.mockResolvedValue(["fld-1", "fld-2"]);

      const result = await updateVisibleTaskFieldsAction.run(
        { fieldIds: ["fld-1", "fld-2"] },
        { userEmail: "alice@example.com", caller: "cli" },
      );

      expect(setTaskCardFieldIds).toHaveBeenCalledWith({
        ownerEmail: "alice@example.com",
        fieldIds: ["fld-1", "fld-2"],
      });
      expect(result).toEqual({ fieldIds: ["fld-1", "fld-2"] });
    });

    it("propagates validation errors from the store", async () => {
      setTaskCardFieldIds.mockRejectedValue(
        new Error("fieldIds must reference existing custom fields."),
      );

      await expect(
        updateVisibleTaskFieldsAction.run(
          { fieldIds: ["fld-missing"] },
          { userEmail: "alice@example.com", caller: "cli" },
        ),
      ).rejects.toThrow("fieldIds must reference existing custom fields.");
    });
  });
});
