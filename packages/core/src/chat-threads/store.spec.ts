import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());
const emitChatThreadChangeMock = vi.hoisted(() => vi.fn());

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
  intType: () => "INTEGER",
  isPostgres: () => false,
}));

vi.mock("./emitter.js", () => ({
  emitChatThreadChange: emitChatThreadChangeMock,
}));

import {
  createThreadShareLink,
  forkThread,
  getThreadByShareToken,
  listThreads,
  renameThread,
  revokeThreadShareLink,
  searchThreads,
  setThreadArchived,
  setThreadPinned,
  setThreadQueuedMessages,
  updateThreadData,
} from "./store.js";

type ChatThreadRow = {
  id: string;
  owner_email: string;
  title: string;
  preview: string;
  thread_data: string;
  message_count: number;
  created_at: number;
  updated_at: number;
  scope_type?: string | null;
  scope_id?: string | null;
  scope_label?: string | null;
  pinned_at?: number | null;
  archived_at?: number | null;
};

const userMessage = {
  id: "user-1",
  role: "user",
  content: [{ type: "text", text: "make this slide better" }],
};

const assistantMessage = {
  id: "assistant-1",
  role: "assistant",
  content: [{ type: "text", text: "Done." }],
  status: { type: "complete", reason: "stop" },
  metadata: { runId: "run-1" },
};

describe("chat thread store", () => {
  let row: ChatThreadRow | null;
  let conflictOnce: (() => void) | null;

  beforeEach(() => {
    row = {
      id: "thread-1",
      owner_email: "user@example.com",
      title: "Thread",
      preview: "make this slide better",
      thread_data: JSON.stringify({ messages: [userMessage] }),
      message_count: 1,
      created_at: 1,
      updated_at: 1,
    };
    conflictOnce = null;
    executeMock.mockReset();
    emitChatThreadChangeMock.mockReset();
    executeMock.mockImplementation(async (query: string | any) => {
      const sql = typeof query === "string" ? query : query.sql;
      const args = typeof query === "string" ? [] : query.args;
      if (/CREATE TABLE/i.test(sql) || /CREATE INDEX/i.test(sql)) {
        return { rows: [], rowsAffected: 0 };
      }
      if (/SELECT id, thread_data, message_count/i.test(sql)) {
        // Legacy message_count backfill probe — no legacy rows in these tests.
        return { rows: [], rowsAffected: 0 };
      }
      if (/WHERE thread_data LIKE \?/i.test(sql)) {
        const pattern = String(args[0] ?? "").replace(/%/g, "");
        return {
          rows: row && row.thread_data.includes(pattern) ? [row] : [],
          rowsAffected: 0,
        };
      }
      if (/SELECT id, owner_email/i.test(sql)) {
        return {
          rows: row && args[0] === row.id ? [row] : [],
          rowsAffected: 0,
        };
      }
      if (/UPDATE chat_threads SET thread_data/i.test(sql)) {
        if (conflictOnce) {
          const applyConflict = conflictOnce;
          conflictOnce = null;
          applyConflict();
          return { rows: [], rowsAffected: 0 };
        }
        if (!row || row.id !== args[5] || row.updated_at !== args[6]) {
          return { rows: [], rowsAffected: 0 };
        }
        row = {
          ...row,
          thread_data: args[0],
          title: args[1],
          preview: args[2],
          message_count: args[3],
          updated_at: args[4],
        };
        return { rows: [], rowsAffected: 1 };
      }
      if (/UPDATE chat_threads SET pinned_at/i.test(sql)) {
        if (!row || row.id !== args[1]) {
          return { rows: [], rowsAffected: 0 };
        }
        if (args[2] && row.owner_email !== args[2]) {
          return { rows: [], rowsAffected: 0 };
        }
        row = { ...row, pinned_at: args[0] };
        return { rows: [], rowsAffected: 1 };
      }
      if (/UPDATE chat_threads SET archived_at/i.test(sql)) {
        if (!row || row.id !== args[1]) {
          return { rows: [], rowsAffected: 0 };
        }
        if (args[2] && row.owner_email !== args[2]) {
          return { rows: [], rowsAffected: 0 };
        }
        row = { ...row, archived_at: args[0] };
        return { rows: [], rowsAffected: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
  });

  it("retries cross-process thread-data conflicts and preserves server-only messages", async () => {
    conflictOnce = () => {
      row = {
        ...row!,
        thread_data: JSON.stringify({
          messages: [
            { message: userMessage, parentId: null },
            { message: assistantMessage, parentId: "user-1" },
          ],
        }),
        message_count: 2,
        updated_at: 2,
      };
    };

    await updateThreadData(
      "thread-1",
      JSON.stringify({ messages: [userMessage] }),
      "Thread",
      "make this slide better",
      1,
    );

    const repo = JSON.parse(row!.thread_data);
    expect(repo.messages.map((entry: any) => entry.message.id)).toEqual([
      "user-1",
      "assistant-1",
    ]);
    expect(row!.message_count).toBe(2);
    expect(emitChatThreadChangeMock).toHaveBeenCalledWith("thread-1");
  });

  it("does not retain empty assistant placeholders when saving the real answer", async () => {
    row!.thread_data = JSON.stringify({
      messages: [
        { message: userMessage, parentId: null },
        {
          message: { id: "placeholder", role: "assistant", content: [] },
          parentId: "user-1",
        },
      ],
      headId: "placeholder",
    });
    row!.message_count = 2;

    await updateThreadData(
      "thread-1",
      JSON.stringify({
        messages: [
          { message: userMessage, parentId: null },
          { message: assistantMessage, parentId: "user-1" },
        ],
        headId: "assistant-1",
      }),
      "Thread",
      "Done.",
      2,
    );

    const repo = JSON.parse(row!.thread_data);
    expect(repo.messages.map((entry: any) => entry.message.id)).toEqual([
      "user-1",
      "assistant-1",
    ]);
    expect(repo.messages[1].parentId).toBe("user-1");
    expect(repo.headId).toBe("assistant-1");
    expect(row!.message_count).toBe(2);
  });

  it("lets queued-message clears win while preserving concurrent assistant messages", async () => {
    row!.thread_data = JSON.stringify({
      queuedMessages: [{ id: "queued-1", text: "next" }],
      messages: [{ message: userMessage, parentId: null }],
    });

    conflictOnce = () => {
      row = {
        ...row!,
        thread_data: JSON.stringify({
          queuedMessages: [{ id: "queued-1", text: "next" }],
          messages: [
            { message: userMessage, parentId: null },
            { message: assistantMessage, parentId: "user-1" },
          ],
        }),
        message_count: 2,
        updated_at: 2,
      };
    };

    await setThreadQueuedMessages("thread-1", []);

    const repo = JSON.parse(row!.thread_data);
    expect(repo.queuedMessages).toBeUndefined();
    expect(repo.messages.map((entry: any) => entry.message.id)).toEqual([
      "user-1",
      "assistant-1",
    ]);
  });

  it("pins and archives threads as lightweight metadata", async () => {
    await setThreadPinned("thread-1", true);
    expect(row!.pinned_at).toEqual(expect.any(Number));
    expect(row!.updated_at).toBe(1);

    await setThreadPinned("thread-1", false);
    expect(row!.pinned_at).toBeNull();
    expect(row!.updated_at).toBe(1);

    await setThreadArchived("thread-1", true);
    expect(row!.archived_at).toEqual(expect.any(Number));
    expect(row!.updated_at).toBe(1);
    expect(emitChatThreadChangeMock).toHaveBeenCalledTimes(3);
  });

  it("refuses to pin or archive a thread for a different owner", async () => {
    const pinned = await setThreadPinned("thread-1", true, {
      ownerEmail: "other@example.com",
    });
    const archived = await setThreadArchived("thread-1", true, {
      ownerEmail: "other@example.com",
    });

    expect(pinned).toBe(false);
    expect(archived).toBe(false);
    expect(row!.pinned_at).toBeUndefined();
    expect(row!.archived_at).toBeUndefined();
    expect(row!.updated_at).toBe(1);
    expect(emitChatThreadChangeMock).not.toHaveBeenCalled();
  });

  it("creates, resolves, and revokes read-only share links", async () => {
    const link = await createThreadShareLink("thread-1", {
      ownerEmail: "user@example.com",
    });
    expect(link?.enabled).toBe(true);
    expect(link?.token).toEqual(expect.any(String));

    const repo = JSON.parse(row!.thread_data);
    expect(repo._share.tokenHash).toEqual(expect.any(String));
    expect(repo._share.tokenHash).not.toBe(link!.token);

    const shared = await getThreadByShareToken(link!.token);
    expect(shared?.id).toBe("thread-1");

    const revoked = await revokeThreadShareLink("thread-1", {
      ownerEmail: "user@example.com",
    });
    expect(revoked?.enabled).toBe(false);
    expect(await getThreadByShareToken(link!.token)).toBeNull();
  });

  it("searches thread text with literal LIKE metacharacters", async () => {
    executeMock.mockImplementation(async (query: string | any) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (/CREATE TABLE/i.test(sql) || /CREATE INDEX/i.test(sql)) {
        return { rows: [], rowsAffected: 0 };
      }
      if (/SELECT .* FROM chat_threads WHERE/i.test(sql)) {
        return { rows: [], rowsAffected: 0 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await searchThreads("user@example.com", "100%_done");

    // Match the search query specifically (its WHERE has the ESCAPE clause),
    // not the legacy-count backfill probe that also reads from chat_threads.
    const searchCall = executeMock.mock.calls.find(([query]) => {
      const sql = typeof query === "string" ? query : query.sql;
      return (
        /SELECT .* FROM chat_threads WHERE/i.test(sql) && /ESCAPE/i.test(sql)
      );
    });
    expect(searchCall).toBeTruthy();
    const query = searchCall![0] as { sql: string; args: unknown[] };
    expect(query.sql).toContain("LIKE ? ESCAPE '!'");
    expect(query.args.slice(1, 4)).toEqual([
      "%100!%!_done%",
      "%100!%!_done%",
      "%100!%!_done%",
    ]);
  });

  it("lists threads without loading the thread_data blob and filters on message_count", async () => {
    const summaryRow = {
      id: "thread-1",
      title: "Thread",
      preview: "make this slide better",
      message_count: 1,
      created_at: 1,
      updated_at: 2,
      scope_type: null,
      scope_id: null,
      scope_label: null,
      pinned_at: null,
      archived_at: null,
    };
    executeMock.mockImplementation(async (query: string | any) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (/CREATE TABLE/i.test(sql) || /CREATE INDEX/i.test(sql)) {
        return { rows: [], rowsAffected: 0 };
      }
      if (/SELECT id, thread_data, message_count/i.test(sql)) {
        return { rows: [], rowsAffected: 0 };
      }
      if (/SELECT .* FROM chat_threads WHERE/i.test(sql)) {
        return { rows: [summaryRow], rowsAffected: 0 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await listThreads("user@example.com", { limit: 10 });

    const listCall = executeMock.mock.calls.find(([query]) => {
      const sql = typeof query === "string" ? query : query.sql;
      return (
        /SELECT .* FROM chat_threads WHERE/i.test(sql) && /ORDER BY/i.test(sql)
      );
    });
    expect(listCall).toBeTruthy();
    const sql = (listCall![0] as { sql: string }).sql;
    // The list SELECT must NOT pull the heavy thread_data blob...
    expect(sql).not.toContain("thread_data");
    // ...and the "has messages" filter is the maintained column, no LIKE scan.
    expect(sql).toContain("message_count > 0");
    expect(sql).not.toMatch(/thread_data LIKE/i);
    expect(result.map((t) => t.id)).toEqual(["thread-1"]);
    expect(result[0].messageCount).toBe(1);
  });

  it("backfills message_count for legacy rows so they stay in the list", async () => {
    // ensureTable caches its bootstrap promise at module scope, so reset the
    // module registry to force a fresh bootstrap (and the one-time backfill)
    // for this assertion.
    vi.resetModules();
    const updates: Array<{ count: number; id: string }> = [];
    executeMock.mockImplementation(async (query: string | any) => {
      const sql = typeof query === "string" ? query : query.sql;
      const args = typeof query === "string" ? [] : query.args;
      if (/CREATE TABLE/i.test(sql) || /CREATE INDEX/i.test(sql)) {
        return { rows: [], rowsAffected: 0 };
      }
      // The legacy backfill probe: a row that has messages but count = 0.
      if (/SELECT id, thread_data, message_count/i.test(sql)) {
        return {
          rows: [
            {
              id: "legacy-1",
              thread_data: JSON.stringify({
                messages: [
                  { message: userMessage, parentId: null },
                  { message: assistantMessage, parentId: "user-1" },
                ],
              }),
              message_count: 0,
            },
          ],
          rowsAffected: 0,
        };
      }
      if (
        /UPDATE chat_threads SET message_count = \? WHERE id = \?/i.test(sql)
      ) {
        updates.push({ count: args[0], id: args[1] });
        return { rows: [], rowsAffected: 1 };
      }
      if (/SELECT .* FROM chat_threads WHERE/i.test(sql)) {
        return { rows: [], rowsAffected: 0 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const freshStore = await import("./store.js");
    await freshStore.listThreads("user@example.com");

    expect(updates).toEqual([{ count: 2, id: "legacy-1" }]);
  });

  it("renames threads with a durable title override", async () => {
    await renameThread("thread-1", "  Better   title  ");

    expect(row!.title).toBe("Better title");
    expect(JSON.parse(row!.thread_data)._titleOverride).toBe("Better title");
    expect(emitChatThreadChangeMock).toHaveBeenCalledWith("thread-1");
  });

  it("refuses to rename a thread for a different owner", async () => {
    const renamed = await renameThread("thread-1", "Other title", {
      ownerEmail: "other@example.com",
    });

    expect(renamed).toBe(false);
    expect(row!.title).toBe("Thread");
    expect(JSON.parse(row!.thread_data)._titleOverride).toBeUndefined();
    expect(emitChatThreadChangeMock).not.toHaveBeenCalled();
  });

  it("forks from a client snapshot when the source thread is not persisted yet", async () => {
    const rows = new Map<string, ChatThreadRow>();
    executeMock.mockImplementation(async (query: string | any) => {
      const sql = typeof query === "string" ? query : query.sql;
      const args = typeof query === "string" ? [] : query.args;
      if (
        /CREATE TABLE/i.test(sql) ||
        /ALTER TABLE/i.test(sql) ||
        /CREATE INDEX/i.test(sql)
      ) {
        return { rows: [], rowsAffected: 0 };
      }
      if (/SELECT id, thread_data, message_count/i.test(sql)) {
        return { rows: [], rowsAffected: 0 };
      }
      if (/SELECT id, owner_email/i.test(sql)) {
        const found = rows.get(args[0]);
        return { rows: found ? [found] : [], rowsAffected: 0 };
      }
      if (/INSERT INTO chat_threads/i.test(sql)) {
        if (args.length === 8) {
          rows.set(args[0], {
            id: args[0],
            owner_email: args[1],
            title: args[2],
            preview: "",
            thread_data: "{}",
            message_count: 0,
            created_at: args[3],
            updated_at: args[4],
            scope_type: args[5],
            scope_id: args[6],
            scope_label: args[7],
          });
          return { rows: [], rowsAffected: 1 };
        }
        rows.set(args[0], {
          id: args[0],
          owner_email: args[1],
          title: args[2],
          preview: args[3],
          thread_data: args[4],
          message_count: args[5],
          created_at: args[6],
          updated_at: args[7],
          scope_type: args[8],
          scope_id: args[9],
          scope_label: args[10],
        });
        return { rows: [], rowsAffected: 1 };
      }
      if (/UPDATE chat_threads SET thread_data/i.test(sql)) {
        const current = rows.get(args[5]);
        if (!current || current.updated_at !== args[6]) {
          return { rows: [], rowsAffected: 0 };
        }
        rows.set(args[5], {
          ...current,
          thread_data: args[0],
          title: args[1],
          preview: args[2],
          message_count: args[3],
          updated_at: args[4],
        });
        return { rows: [], rowsAffected: 1 };
      }
      if (/UPDATE chat_threads SET scope_type/i.test(sql)) {
        const current = rows.get(args[4]);
        if (current) {
          rows.set(args[4], {
            ...current,
            scope_type: args[0],
            scope_id: args[1],
            scope_label: args[2],
            updated_at: args[3],
          });
        }
        return { rows: [], rowsAffected: current ? 1 : 0 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const sourceRepo = {
      messages: [
        { message: userMessage, parentId: null },
        { message: assistantMessage, parentId: "user-1" },
      ],
    };

    const forked = await forkThread("thread-unflushed", "user@example.com", {
      id: "thread-forked",
      source: {
        threadData: JSON.stringify(sourceRepo),
        title: "Thread",
        preview: "make this slide better",
        messageCount: 2,
        scope: { type: "dashboard", id: "dash-1", label: "Pipeline" },
      },
    });

    expect(forked?.id).toBe("thread-forked");
    expect(rows.get("thread-unflushed")?.message_count).toBe(2);
    expect(rows.get("thread-unflushed")?.scope_type).toBe("dashboard");
    expect(
      JSON.parse(rows.get("thread-forked")!.thread_data).messages,
    ).toHaveLength(2);
  });

  it("prefers the fresher in-memory snapshot when the source row already exists with older data", async () => {
    const staleRepo = {
      messages: [{ message: userMessage, parentId: null }],
    };
    const freshRepo = {
      messages: [
        { message: userMessage, parentId: null },
        { message: assistantMessage, parentId: "user-1" },
      ],
    };
    const rows = new Map<string, ChatThreadRow>([
      [
        "thread-stale",
        {
          id: "thread-stale",
          owner_email: "user@example.com",
          title: "Old title",
          preview: "old preview",
          thread_data: JSON.stringify(staleRepo),
          message_count: 1,
          created_at: 0,
          updated_at: 0,
          scope_type: null,
          scope_id: null,
          scope_label: null,
        },
      ],
    ]);
    executeMock.mockImplementation(async (query: string | any) => {
      const sql = typeof query === "string" ? query : query.sql;
      const args = typeof query === "string" ? [] : query.args;
      if (
        /CREATE TABLE/i.test(sql) ||
        /ALTER TABLE/i.test(sql) ||
        /CREATE INDEX/i.test(sql)
      ) {
        return { rows: [], rowsAffected: 0 };
      }
      if (/SELECT id, thread_data, message_count/i.test(sql)) {
        return { rows: [], rowsAffected: 0 };
      }
      if (/SELECT id, owner_email/i.test(sql)) {
        const found = rows.get(args[0]);
        return { rows: found ? [found] : [], rowsAffected: 0 };
      }
      if (/INSERT INTO chat_threads/i.test(sql)) {
        rows.set(args[0], {
          id: args[0],
          owner_email: args[1],
          title: args[2],
          preview: args[3],
          thread_data: args[4],
          message_count: args[5],
          created_at: args[6],
          updated_at: args[7],
          scope_type: args[8],
          scope_id: args[9],
          scope_label: args[10],
        });
        return { rows: [], rowsAffected: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const forked = await forkThread("thread-stale", "user@example.com", {
      id: "thread-forked",
      source: {
        threadData: JSON.stringify(freshRepo),
        title: "Old title",
        preview: "fresher preview",
        messageCount: 2,
      },
    });

    expect(forked?.id).toBe("thread-forked");
    expect(forked?.messageCount).toBe(2);
    expect(forked?.preview).toBe("fresher preview");
    expect(
      JSON.parse(rows.get("thread-forked")!.thread_data).messages,
    ).toHaveLength(2);
  });

  it("ignores stale snapshots when the persisted row is fresher", async () => {
    const persistedRepo = {
      messages: [
        { message: userMessage, parentId: null },
        { message: assistantMessage, parentId: "user-1" },
      ],
    };
    const rows = new Map<string, ChatThreadRow>([
      [
        "thread-fresh",
        {
          id: "thread-fresh",
          owner_email: "user@example.com",
          title: "Fresh",
          preview: "fresh preview",
          thread_data: JSON.stringify(persistedRepo),
          message_count: 2,
          created_at: 0,
          updated_at: 0,
          scope_type: null,
          scope_id: null,
          scope_label: null,
        },
      ],
    ]);
    executeMock.mockImplementation(async (query: string | any) => {
      const sql = typeof query === "string" ? query : query.sql;
      const args = typeof query === "string" ? [] : query.args;
      if (
        /CREATE TABLE/i.test(sql) ||
        /ALTER TABLE/i.test(sql) ||
        /CREATE INDEX/i.test(sql)
      ) {
        return { rows: [], rowsAffected: 0 };
      }
      if (/SELECT id, thread_data, message_count/i.test(sql)) {
        return { rows: [], rowsAffected: 0 };
      }
      if (/SELECT id, owner_email/i.test(sql)) {
        const found = rows.get(args[0]);
        return { rows: found ? [found] : [], rowsAffected: 0 };
      }
      if (/INSERT INTO chat_threads/i.test(sql)) {
        rows.set(args[0], {
          id: args[0],
          owner_email: args[1],
          title: args[2],
          preview: args[3],
          thread_data: args[4],
          message_count: args[5],
          created_at: args[6],
          updated_at: args[7],
          scope_type: args[8],
          scope_id: args[9],
          scope_label: args[10],
        });
        return { rows: [], rowsAffected: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const staleRepo = {
      messages: [{ message: userMessage, parentId: null }],
    };
    const forked = await forkThread("thread-fresh", "user@example.com", {
      id: "thread-forked-stale",
      source: {
        threadData: JSON.stringify(staleRepo),
        title: "Fresh",
        preview: "stale preview",
        messageCount: 1,
      },
    });

    // Fresh persisted data wins.
    expect(forked?.messageCount).toBe(2);
    expect(
      JSON.parse(rows.get("thread-forked-stale")!.thread_data).messages,
    ).toHaveLength(2);
  });
});
