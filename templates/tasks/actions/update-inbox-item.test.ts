import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateInboxItem } = vi.hoisted(() => ({
  updateInboxItem: vi.fn(),
}));

vi.mock("../server/inbox/store.js", () => ({
  updateInboxItem,
  requireUserEmail: (email: string | undefined) => {
    if (!email) throw new Error("Authentication required.");
    return email;
  },
}));

import updateInboxItemAction, {
  updateInboxItemSchema,
} from "./update-inbox-item.js";

describe("update-inbox-item", () => {
  beforeEach(() => {
    updateInboxItem.mockReset();
  });

  describe("schema", () => {
    it("accepts inboxItemId and optional title", () => {
      expect(
        updateInboxItemSchema.parse({
          inboxItemId: "in-1",
          title: "Updated",
        }),
      ).toEqual({
        inboxItemId: "in-1",
        title: "Updated",
      });
      expect(() =>
        updateInboxItemSchema.parse({ inboxItemId: "in-1", title: "" }),
      ).toThrow();
    });
  });

  describe("run", () => {
    it("rejects missing title before calling the store", async () => {
      await expect(
        updateInboxItemAction.run(
          { inboxItemId: "in-1" },
          { userEmail: "alice@example.com", caller: "cli" },
        ),
      ).rejects.toThrow(/title/i);
      expect(updateInboxItem).not.toHaveBeenCalled();
    });

    it("updates an owned inbox item title", async () => {
      updateInboxItem.mockResolvedValue({
        id: "in-1",
        title: "Updated",
        sortOrder: 0,
        ownerEmail: "alice@example.com",
        createdAt: "2026-06-22T10:00:00.000Z",
        updatedAt: "2026-06-22T11:00:00.000Z",
      });

      const result = await updateInboxItemAction.run(
        { inboxItemId: "in-1", title: "Updated" },
        { userEmail: "alice@example.com", caller: "cli" },
      );

      expect(updateInboxItem).toHaveBeenCalledWith({
        ownerEmail: "alice@example.com",
        id: "in-1",
        title: "Updated",
      });
      expect(result).toMatchObject({ id: "in-1", title: "Updated" });
    });
  });
});
