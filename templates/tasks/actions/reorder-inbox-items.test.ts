import { beforeEach, describe, expect, it, vi } from "vitest";

const { reorderInboxItems } = vi.hoisted(() => ({
  reorderInboxItems: vi.fn(),
}));

vi.mock("../server/inbox/store.js", () => ({
  reorderInboxItems,
  requireUserEmail: (email: string | undefined) => {
    if (!email) throw new Error("Authentication required.");
    return email;
  },
}));

import reorderInboxItemsAction from "./reorder-inbox-items.js";

describe("reorder-inbox-items", () => {
  beforeEach(() => {
    reorderInboxItems.mockReset();
  });

  describe("schema", () => {
    it("requires at least one inbox item id", () => {
      expect(
        reorderInboxItemsAction.schema.parse({
          inboxItemIds: ["in-2", "in-1"],
        }),
      ).toEqual({
        inboxItemIds: ["in-2", "in-1"],
      });
      expect(() =>
        reorderInboxItemsAction.schema.parse({ inboxItemIds: [] }),
      ).toThrow();
    });
  });

  describe("run", () => {
    it("reorders inbox items for the current user", async () => {
      const items = [
        {
          id: "in-2",
          title: "Second",
          sortOrder: 0,
          ownerEmail: "alice@example.com",
          createdAt: "2026-06-22T10:00:00.000Z",
          updatedAt: "2026-06-22T11:00:00.000Z",
        },
        {
          id: "in-1",
          title: "First",
          sortOrder: 1000,
          ownerEmail: "alice@example.com",
          createdAt: "2026-06-22T10:00:00.000Z",
          updatedAt: "2026-06-22T11:00:00.000Z",
        },
      ];
      reorderInboxItems.mockResolvedValue({ items });

      const result = await reorderInboxItemsAction.run(
        { inboxItemIds: ["in-2", "in-1"] },
        { userEmail: "alice@example.com", caller: "cli" },
      );

      expect(reorderInboxItems).toHaveBeenCalledWith({
        ownerEmail: "alice@example.com",
        inboxItemIds: ["in-2", "in-1"],
      });
      expect(result).toEqual({ items });
    });
  });
});
