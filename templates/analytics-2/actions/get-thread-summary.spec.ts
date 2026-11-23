import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  thread: vi.fn(),
  workspace: vi.fn(),
}));
vi.mock("@agent-native/core/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/db")>()),
  getDbExec: () => ({
    execute: async () => {
      const row = await mocks.thread();
      return {
        rows: row
          ? [
              {
                id: row.id,
                title: row.title,
                owner_email: row.ownerEmail,
                org_id: row.orgId,
                scope_type: row.scope.type,
                scope_id: row.scope.id,
              },
            ]
          : [],
      };
    },
  }),
}));
vi.mock("@agent-native/core/sharing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/sharing")>()),
  resolveAccess: mocks.access,
}));
vi.mock("../server/lib/workspace-access.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/workspace-access.js")
  >()),
  requireCurrentWorkspace: mocks.workspace,
}));
vi.mock("../server/model/database.js", () => ({
  ensureAnalyticsDatabase: async () => {},
}));
vi.mock("../server/model/analytics-thread-bootstrap.js", () => ({
  readAnalyticsThreadAccess: async () => null,
}));
import action from "./get-thread-summary";
const thread = {
  id: "thread-1",
  title: "",
  ownerEmail: "owner@example.test",
  orgId: "org-1",
  scope: { type: "workspace-app", id: "analytics-2:org:org-1" },
  threadData: "private transcript",
  messageCount: 0,
};
const run = () =>
  action.run({ threadId: "thread-1" }, { appId: "analytics-2" } as never);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspace.mockResolvedValue({
    ownerEmail: "owner@example.test",
    orgId: "org-1",
  });
  mocks.access.mockResolvedValue({ role: "owner" });
  mocks.thread.mockResolvedValue(thread);
});
it("reads an accessible empty thread directly and returns metadata without its transcript", async () => {
  expect(await run()).toEqual({
    thread: { id: "thread-1", title: "", owned: true },
    binding: null,
    workingHead: null,
    listed: true,
    canSubmit: true,
    canShare: true,
    throughSequence: null,
  });
  expect(mocks.access).toHaveBeenCalledWith(
    "chat_thread",
    "thread-1",
    {
      userEmail: "owner@example.test",
      orgId: "org-1",
    },
    { skipResourceBody: true },
  );
});
it("reads an explicitly shared thread without offering owner controls", async () => {
  mocks.access.mockResolvedValue({ role: "viewer" });
  mocks.thread.mockResolvedValue({
    ...thread,
    ownerEmail: "another@example.test",
    title: "Shared analysis",
    messageCount: 20,
  });
  expect(await run()).toEqual({
    thread: { id: "thread-1", title: "Shared analysis", owned: false },
    binding: null,
    workingHead: null,
    listed: true,
    canSubmit: false,
    canShare: false,
    throughSequence: null,
  });
});
it.each([
  null,
  { ...thread, orgId: "org-2" },
  { ...thread, scope: { type: "workspace-app", id: "other-app:org:org-1" } },
])("does not reveal absent or foreign-scope metadata", async (value) => {
  mocks.thread.mockResolvedValue(value);
  await expect(run()).rejects.toMatchObject({
    errorCode: "not_found",
    statusCode: 404,
  });
});
it("refuses an inaccessible thread before reading its body", async () => {
  mocks.access.mockResolvedValue(null);
  await expect(run()).rejects.toMatchObject({
    errorCode: "not_found",
    statusCode: 404,
  });
  expect(mocks.thread).not.toHaveBeenCalled();
});
it("keeps a failed access lookup distinct from an absent thread", async () => {
  const error = new Error("Storage unavailable");
  mocks.access.mockRejectedValue(error);
  await expect(run()).rejects.toBe(error);
  expect(mocks.thread).not.toHaveBeenCalled();
});
