import { beforeAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

const pglite = vi.hoisted(() => ({ current: null as any }));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({
    execute: async (input: { sql: string; args?: unknown[] }) => ({
      rows: (await pglite.current.query(input.sql, input.args ?? [])).rows,
    }),
  }),
}));
vi.mock("./store.js", () => ({
  escapeLike: (s: string) => s.replace(/[!%_]/g, (m) => `!${m}`),
}));

const { auditChats } = await import("./audit.js");

beforeAll(async () => {
  pglite.current = await createTestPglite();
  await pglite.current.exec(`
    CREATE TABLE chat_threads (id TEXT PRIMARY KEY, owner_email TEXT, title TEXT, message_count INT,
      created_at BIGINT, updated_at BIGINT, archived_at BIGINT, scope_type TEXT, scope_id TEXT,
      source_url TEXT, thread_data TEXT);
    CREATE TABLE agent_runs (id TEXT PRIMARY KEY, thread_id TEXT, turn_id TEXT, status TEXT,
      started_at BIGINT, completed_at BIGINT, terminal_reason TEXT, error_code TEXT, dispatch_mode TEXT);
    CREATE TABLE agent_turn_initiators (thread_id TEXT, turn_id TEXT, principal_email TEXT);
    INSERT INTO chat_threads VALUES
      ('t1', 'alice@x.com', 'Deck edits', 2, 1, 10, NULL, 'slides', 'deck-123', NULL, '{}'),
      ('t2', 'bob@x.com', 'Shared', 2, 1, 20, NULL, NULL, NULL, NULL, 'see https://app/decks/deck-123'),
      ('t3', 'carol@x.com', 'Unrelated', 2, 1, 30, NULL, NULL, NULL, NULL, '{}');
    INSERT INTO agent_runs VALUES
      ('r1', 't1', 'r1', 'completed', 5, 6, NULL, NULL, NULL),
      ('r2', 't2', 'r2', 'error', 15, 16, 'error:boom', 'boom', 'background');
    INSERT INTO agent_turn_initiators VALUES ('t2', 'r2', 'alice@x.com');
  `);
});

describe("auditChats", () => {
  it("finds chats an email owns or sent a turn in, with the initiator on each run", async () => {
    const threads = await auditChats({ email: "ALICE@x.com" });

    expect(threads.map((t) => t.threadId)).toEqual(["t2", "t1"]);
    expect(threads[0].runs).toEqual([
      expect.objectContaining({
        runId: "r2",
        status: "error",
        errorCode: "boom",
        initiatorEmail: "alice@x.com",
      }),
    ]);
  });

  it("matches a deck URL against scope id and message text, not unrelated chats", async () => {
    const threads = await auditChats({
      deck: "https://app/decks/deck-123?view=edit",
    });

    expect(threads.map((t) => t.threadId)).toEqual(["t2", "t1"]);
  });
});
