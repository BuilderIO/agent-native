import { beforeEach, describe, expect, it, vi } from "vitest";

const { deleteInboxItem } = vi.hoisted(() => ({
  deleteInboxItem: vi.fn(),
}));

vi.mock("../server/inbox/store.js", () => ({
  deleteInboxItem,
  requireUserEmail: (email: string | undefined) => {
    if (!email) throw new Error("Authentication required.");
    return email;
  },
}));

import bulkDeleteInboxItemsAction from "./bulk-delete-inbox-items.js";

describe("bulk-delete-inbox-items", () => {
  beforeEach(() => {
    deleteInboxItem.mockReset();
  });

  describe("schema", () => {
    it("requires at least one inbox item id", () => {
      expect(
        bulkDeleteInboxItemsAction.schema.parse({
          inboxItemIds: ["in-1", "in-2"],
        }),
      ).toEqual({
        inboxItemIds: ["in-1", "in-2"],
      });
      expect(() =>
        bulkDeleteInboxItemsAction.schema.parse({ inboxItemIds: [] }),
      ).toThrow();
    });
  });

  describe("run", () => {
    it("deletes each inbox item", async () => {
      deleteInboxItem.mockResolvedValue(undefined);

      const result = await bulkDeleteInboxItemsAction.run(
        { inboxItemIds: ["in-1", "in-2"] },
        { userEmail: "alice@example.com", caller: "cli" },
      );

      expect(deleteInboxItem).toHaveBeenCalledTimes(2);
      expect(deleteInboxItem).toHaveBeenNthCalledWith(1, {
        ownerEmail: "alice@example.com",
        id: "in-1",
      });
      expect(deleteInboxItem).toHaveBeenNthCalledWith(2, {
        ownerEmail: "alice@example.com",
        id: "in-2",
      });
      expect(result).toEqual({ ok: true, deleted: 2 });
    });
  });
});
