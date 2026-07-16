import { beforeEach, describe, expect, it, vi } from "vitest";

const { listInboxItems } = vi.hoisted(() => ({
  listInboxItems: vi.fn(),
}));

vi.mock("../server/inbox/store.js", () => ({
  listInboxItems,
  requireUserEmail: (email: string | undefined) => {
    if (!email) throw new Error("Authentication required.");
    return email;
  },
}));

import listInboxItemsAction from "./list-inbox-items.js";

describe("list-inbox-items", () => {
  beforeEach(() => {
    listInboxItems.mockReset();
  });

  describe("schema", () => {
    it("accepts an empty object", () => {
      expect(listInboxItemsAction.schema.parse({})).toEqual({});
    });
  });

  describe("run", () => {
    it("returns inbox items for the current user", async () => {
      const items = [
        {
          id: "in-1",
          title: "One",
          sortOrder: 0,
          ownerEmail: "alice@example.com",
          createdAt: "2026-06-22T10:00:00.000Z",
          updatedAt: "2026-06-22T10:00:00.000Z",
        },
      ];
      listInboxItems.mockResolvedValue(items);

      const result = await listInboxItemsAction.run(
        {},
        { userEmail: "alice@example.com", caller: "cli" },
      );

      expect(listInboxItems).toHaveBeenCalledWith({
        ownerEmail: "alice@example.com",
      });
      expect(result).toEqual({ items });
    });
  });
});
