import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentWorkspace: vi.fn(),
  getThread: vi.fn(),
  deleteThread: vi.fn(),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getThread: mocks.getThread,
  deleteThread: mocks.deleteThread,
}));
vi.mock("../server/lib/workspace-access.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/workspace-access.js")
  >()),
  requireCurrentWorkspace: mocks.currentWorkspace,
}));

import action from "./delete-thread.js";

const current = {
  ownerEmail: "owner@example.test",
  orgId: "org-1",
};
const thread = {
  id: "thread-1",
  ownerEmail: current.ownerEmail,
  title: "Revenue by channel",
  preview: "",
  threadData: "{}",
  messageCount: 1,
  createdAt: 1,
  updatedAt: 1,
  scope: {
    type: "workspace-app",
    id: "analytics-2:org:org-1",
  },
  pinnedAt: null,
  archivedAt: null,
  source: { appId: "analytics-2" },
  orgId: current.orgId,
  visibility: "private" as const,
};

describe("delete-thread action", () => {
  beforeEach(() => {
    mocks.currentWorkspace.mockClear();
    mocks.getThread.mockClear();
    mocks.deleteThread.mockClear();
    mocks.currentWorkspace.mockResolvedValue(current);
    mocks.getThread.mockResolvedValue(thread);
    mocks.deleteThread.mockResolvedValue(true);
  });

  it("deletes an owned thread in the active app and workspace", async () => {
    await expect(
      action.run({ threadId: "thread-1" }, { appId: "analytics-2" } as never),
    ).resolves.toEqual({ id: "thread-1", deleted: true });
    expect(mocks.deleteThread).toHaveBeenCalledWith(
      "thread-1",
      current.ownerEmail,
      {
        orgId: current.orgId,
        collapseEdits: true,
      },
    );
  });

  it.each([
    ["another owner", { ...thread, ownerEmail: "someone@example.test" }],
    ["another workspace", { ...thread, orgId: "org-2" }],
    [
      "another app",
      {
        ...thread,
        scope: { type: "workspace-app", id: "other-app:org:org-1" },
      },
    ],
    [
      "another scope",
      { ...thread, scope: { type: "workspace-app", id: "other" } },
    ],
  ])(
    "refuses a thread from %s before deleting",
    async (_label, otherThread) => {
      mocks.getThread.mockResolvedValue(otherThread);
      await expect(
        action.run({ threadId: "thread-1" }, { appId: "analytics-2" } as never),
      ).rejects.toMatchObject({ errorCode: "not_found", noWrite: true });
      expect(mocks.deleteThread).not.toHaveBeenCalled();
    },
  );

  it("refuses when the store reports that the thread was not deleted", async () => {
    mocks.deleteThread.mockResolvedValue(false);
    await expect(
      action.run({ threadId: "thread-1" }, { appId: "analytics-2" } as never),
    ).rejects.toMatchObject({ errorCode: "not_found", noWrite: true });
  });
});
