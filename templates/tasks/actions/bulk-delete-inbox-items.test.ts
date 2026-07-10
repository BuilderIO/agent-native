import { beforeEach, describe, expect, it, vi } from "vitest";

const { bulkDeleteInboxItems } = vi.hoisted(() => ({
  bulkDeleteInboxItems: vi.fn(),
}));

vi.mock("../server/inbox/store.js", () => ({
  bulkDeleteInboxItems,
  requireUserEmail: (email: string | undefined) => {
    if (!email) throw new Error("Authentication required.");
    return email;
  },
}));

import bulkDeleteInboxItemsAction from "./bulk-delete-inbox-items.js";

describe("bulk-delete-inbox-items", () => {
  beforeEach(() => {
    bulkDeleteInboxItems.mockReset();
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
    it("deletes inbox items atomically", async () => {
      bulkDeleteInboxItems.mockResolvedValue({ ok: true, deleted: 2 });

      const result = await bulkDeleteInboxItemsAction.run(
        { inboxItemIds: ["in-1", "in-2"] },
        { userEmail: "alice@example.com", caller: "cli" },
      );

      expect(bulkDeleteInboxItems).toHaveBeenCalledWith({
        ownerEmail: "alice@example.com",
        inboxItemIds: ["in-1", "in-2"],
      });
      expect(result).toEqual({ ok: true, deleted: 2 });
    });
  });
});
