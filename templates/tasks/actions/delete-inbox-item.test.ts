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

import deleteInboxItemAction, {
  deleteInboxItemSchema,
} from "./delete-inbox-item.js";

describe("delete-inbox-item", () => {
  beforeEach(() => {
    deleteInboxItem.mockReset();
  });

  describe("schema", () => {
    it("requires an inbox item id", () => {
      expect(deleteInboxItemSchema.parse({ inboxItemId: "in-1" })).toEqual({
        inboxItemId: "in-1",
      });
    });
  });

  describe("run", () => {
    it("deletes an owned inbox item", async () => {
      deleteInboxItem.mockResolvedValue(undefined);

      const result = await deleteInboxItemAction.run(
        { inboxItemId: "in-1" },
        { userEmail: "alice@example.com", caller: "cli" },
      );

      expect(deleteInboxItem).toHaveBeenCalledWith({
        ownerEmail: "alice@example.com",
        id: "in-1",
      });
      expect(result).toEqual({ ok: true });
    });
  });
});
