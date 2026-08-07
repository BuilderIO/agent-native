import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());
const resolveAccessMock = vi.hoisted(() => vi.fn());

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
  getDialect: () => "sqlite",
  intType: () => "INTEGER",
  isPostgres: () => false,
}));

vi.mock("../sharing/access.js", () => ({
  resolveAccess: resolveAccessMock,
}));

vi.mock("./emitter.js", () => ({ emitChatThreadChange: vi.fn() }));

import { resolveThreadAccess } from "./store.js";

const THREAD_ROW = {
  id: "t1",
  owner_email: "owner@example.com",
  title: "Thread",
  preview: "",
  thread_data: JSON.stringify({ messages: [] }),
  message_count: 0,
  created_at: 1,
  updated_at: 1,
  org_id: null,
  visibility: "private" as const,
};

describe("resolveThreadAccess loads the ACL without the conversation blob", () => {
  beforeEach(() => {
    executeMock.mockReset();
    resolveAccessMock.mockReset();
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 0 });
  });

  it("asks resolveAccess for the projected row, not the full thread", async () => {
    // The access load and `getThread` read the SAME row. Without the projection
    // the access check pulls `thread_data` — the whole conversation history —
    // and then throws it away, so every agent-chat request downloaded the
    // conversation twice. Production showed this as a 94k/71k split across two
    // `chat_threads WHERE id = ?` query shapes.
    resolveAccessMock.mockResolvedValue({
      role: "owner",
      resource: {
        id: "t1",
        ownerEmail: "owner@example.com",
        orgId: null,
        visibility: "private",
      },
    });
    executeMock.mockImplementation(async (query: any) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (/^SELECT .* FROM chat_threads WHERE id = \?/.test(sql)) {
        return { rows: [THREAD_ROW], rowsAffected: 0 };
      }
      return { rows: [], rowsAffected: 0 };
    });

    const thread = await resolveThreadAccess("owner@example.com", "t1");

    expect(thread?.id).toBe("t1");
    expect(resolveAccessMock).toHaveBeenCalledTimes(1);
    expect(resolveAccessMock.mock.calls[0][3]).toEqual({
      skipResourceBody: true,
    });
  });

  it("still denies a caller whose role does not satisfy the minimum", async () => {
    // The projection must not weaken the check it exists to make cheaper.
    resolveAccessMock.mockResolvedValue({
      role: "viewer",
      resource: {
        id: "t1",
        ownerEmail: "owner@example.com",
        orgId: null,
        visibility: "private",
      },
    });

    await expect(
      resolveThreadAccess("viewer@example.com", "t1", "editor"),
    ).resolves.toBeNull();
  });

  it("returns null without touching the DB when access is refused", async () => {
    resolveAccessMock.mockResolvedValue(null);

    await expect(resolveThreadAccess("nobody@example.com", "t1")).resolves.toBe(
      null,
    );
    const threadReads = executeMock.mock.calls.filter(([query]) => {
      const sql = typeof query === "string" ? query : query?.sql;
      return typeof sql === "string" && /FROM chat_threads WHERE id/.test(sql);
    });
    expect(threadReads).toHaveLength(0);
  });
});
