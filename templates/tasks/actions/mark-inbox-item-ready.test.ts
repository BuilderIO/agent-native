import { beforeEach, describe, expect, it, vi } from "vitest";

const { markInboxItemReady } = vi.hoisted(() => ({
  markInboxItemReady: vi.fn(),
}));

vi.mock("../server/inbox/store.js", () => ({
  markInboxItemReady,
  requireUserEmail: (email: string | undefined) => {
    if (!email) throw new Error("Authentication required.");
    return email;
  },
}));

import markInboxItemReadyAction from "./mark-inbox-item-ready.js";

describe("mark-inbox-item-ready", () => {
  beforeEach(() => {
    markInboxItemReady.mockReset();
  });

  describe("schema", () => {
    it("requires an inbox item id", () => {
      expect(
        markInboxItemReadyAction.schema.parse({ inboxItemId: "in-1" }),
      ).toEqual({
        inboxItemId: "in-1",
      });
    });
  });

  describe("run", () => {
    it("promotes an inbox item to a task", async () => {
      markInboxItemReady.mockResolvedValue({
        task: {
          id: "in-1",
          title: "Ready idea",
          done: false,
          sortOrder: 0,
          ownerEmail: "alice@example.com",
          createdAt: "2026-06-22T10:00:00.000Z",
          updatedAt: "2026-06-22T11:00:00.000Z",
        },
      });

      const result = await markInboxItemReadyAction.run(
        { inboxItemId: "in-1" },
        { userEmail: "alice@example.com", caller: "cli" },
      );

      expect(markInboxItemReady).toHaveBeenCalledWith({
        ownerEmail: "alice@example.com",
        id: "in-1",
      });
      expect(result).toMatchObject({
        task: { id: "in-1", title: "Ready idea", done: false },
      });
    });
  });
});
