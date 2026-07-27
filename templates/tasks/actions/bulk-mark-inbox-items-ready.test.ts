import { beforeEach, describe, expect, it, vi } from "vitest";

const { markInboxItemsReady } = vi.hoisted(() => ({
  markInboxItemsReady: vi.fn(),
}));

vi.mock("../server/inbox/store.js", () => ({
  markInboxItemsReady,
  requireUserEmail: (email: string | undefined) => {
    if (!email) throw new Error("Authentication required.");
    return email;
  },
}));

import bulkMarkInboxItemsReadyAction from "./bulk-mark-inbox-items-ready.js";

describe("bulk-mark-inbox-items-ready", () => {
  beforeEach(() => {
    markInboxItemsReady.mockReset();
  });

  it("promotes every selected inbox item atomically", async () => {
    markInboxItemsReady.mockResolvedValue({
      tasks: [
        {
          id: "i1",
          title: "One",
          done: false,
          ownerEmail: "alice@example.com",
        },
        {
          id: "i2",
          title: "Two",
          done: false,
          ownerEmail: "alice@example.com",
        },
      ],
    });

    const result = await bulkMarkInboxItemsReadyAction.run(
      { inboxItemIds: ["i1", "i2"] },
      { userEmail: "alice@example.com", caller: "cli" },
    );

    expect(markInboxItemsReady).toHaveBeenCalledWith({
      ownerEmail: "alice@example.com",
      ids: ["i1", "i2"],
    });
    expect(result).toEqual({
      tasks: [
        {
          id: "i1",
          title: "One",
          done: false,
          ownerEmail: "alice@example.com",
        },
        {
          id: "i2",
          title: "Two",
          done: false,
          ownerEmail: "alice@example.com",
        },
      ],
    });
  });
});
