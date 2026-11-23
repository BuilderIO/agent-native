import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentWorkspace: vi.fn(),
  listThreads: vi.fn(),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  listThreads: mocks.listThreads,
}));
vi.mock("../server/lib/workspace-access.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/workspace-access.js")
  >()),
  requireCurrentWorkspace: mocks.currentWorkspace,
}));

import action from "./list-threads.js";

const current = { ownerEmail: "owner@example.test", orgId: "org-1" };

const row = (id: string) => ({
  id,
  ownerEmail: current.ownerEmail,
  title: `Thread ${id}`,
  preview: "hello",
  messageCount: 2,
  createdAt: 1,
  updatedAt: 2,
  archivedAt: null,
});

describe("list-threads action", () => {
  beforeEach(() => {
    mocks.currentWorkspace.mockResolvedValue(current);
    mocks.listThreads.mockReset();
  });

  it("lists the signed-in owner's threads in the active workspace scope", async () => {
    mocks.listThreads.mockResolvedValue([row("a"), row("b")]);
    const result = await action.run(action.schema.parse({ limit: 5 }), {
      appId: "analytics-2",
    } as never);
    expect(result.threads.map((thread) => thread.id)).toEqual(["a", "b"]);
    expect(result.hasMore).toBe(false);
    expect(mocks.listThreads).toHaveBeenCalledWith(
      current.ownerEmail,
      expect.objectContaining({
        orgId: "org-1",
        ownership: "mine",
        sourceAppId: "analytics-2",
        limit: 6,
        offset: 0,
      }),
    );
  });

  it("reports hasMore when the page overflows", async () => {
    mocks.listThreads.mockResolvedValue([row("a"), row("b"), row("c")]);
    const result = await action.run(action.schema.parse({ limit: 2 }), {
      appId: "analytics-2",
    } as never);
    expect(result.threads).toHaveLength(2);
    expect(result.hasMore).toBe(true);
  });
});
