import { expect, it, vi } from "vitest";

const inbox = vi.hoisted(() => ({
  list: vi.fn(async () => [
    {
      id: "n1",
      title: "Finished",
      body: "Run complete",
      createdAt: "2026-01-01T00:00:00.000Z",
      readAt: null,
    },
  ]),
  count: vi.fn(async () => 1),
  markAll: vi.fn(async () => 1),
}));
vi.mock("@agent-native/core/notifications", () => ({
  listNotifications: inbox.list,
  countUnread: inbox.count,
  markAllNotificationsRead: inbox.markAll,
}));
vi.mock("../server/lib/workspace-access.js", () => ({
  requireCurrentWorkspace: async () => ({ ownerEmail: "reader@example.test" }),
}));

it("report 1794899542.541439 reads and marks the signed-in user's notifications", async () => {
  const { default: list } = await import("./list-workspace-notifications.js");
  const { default: mark } =
    await import("./mark-workspace-notifications-read.js");
  expect(await list.run({}, {} as never)).toMatchObject({
    unreadCount: 1,
    items: [{ id: "n1", title: "Finished", read: false }],
  });
  expect(inbox.list).toHaveBeenCalledWith("reader@example.test", {
    limit: 100,
  });
  await mark.run({}, {} as never);
  expect(inbox.markAll).toHaveBeenCalledWith("reader@example.test");
});
