import { beforeEach, describe, expect, it, vi } from "vitest";

const { createInboxItem } = vi.hoisted(() => ({
  createInboxItem: vi.fn(),
}));

vi.mock("../server/inbox/store.js", () => ({
  createInboxItem,
  requireUserEmail: (email: string | undefined) => {
    if (!email) throw new Error("Authentication required.");
    return email;
  },
}));

import createInboxItemAction from "./create-inbox-item.js";

const sampleItem = {
  id: "in-1",
  title: "Rough idea",
  sortOrder: 0,
  ownerEmail: "alice@example.com",
  createdAt: "2026-06-22T10:00:00.000Z",
  updatedAt: "2026-06-22T10:00:00.000Z",
};

describe("create-inbox-item", () => {
  beforeEach(() => {
    createInboxItem.mockReset();
  });

  describe("schema", () => {
    it("requires a non-empty title", () => {
      expect(createInboxItemAction.schema.parse({ title: "Capture me" })).toEqual({
        title: "Capture me",
      });
      expect(() => createInboxItemAction.schema.parse({ title: "" })).toThrow();
    });
  });

  describe("run", () => {
    it("creates an inbox item for the current user", async () => {
      createInboxItem.mockResolvedValue(sampleItem);

      const result = await createInboxItemAction.run(
        { title: "Rough idea" },
        { userEmail: "alice@example.com", caller: "cli" },
      );

      expect(createInboxItem).toHaveBeenCalledWith({
        ownerEmail: "alice@example.com",
        title: "Rough idea",
      });
      expect(result).toEqual(sampleItem);
    });
  });
});
