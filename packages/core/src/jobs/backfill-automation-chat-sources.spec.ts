import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { DbExec } from "../db/client.js";
import { backfillAutomationChatSources } from "./backfill-automation-chat-sources.js";

const pglite = await createTestPglite();
const executor = (client: Pick<typeof pglite.db, "query">): DbExec => ({
  execute: async (input) => {
    const sql = typeof input === "string" ? input : input.sql;
    const result = await client.query(
      sql,
      typeof input === "string" ? [] : input.args,
    );
    return { rows: result.rows, rowsAffected: result.affectedRows ?? 0 };
  },
});
const db: DbExec = {
  ...executor(pglite.db),
  transaction: (fn) => pglite.db.transaction((tx) => fn(executor(tx))),
};

await pglite.exec(`
  CREATE TABLE chat_threads (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    source_app_id TEXT
  );
  CREATE TABLE automation_run_history (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    thread_id TEXT,
    app_id TEXT
  );
`);
afterAll(() => pglite.close());
beforeEach(async () => {
  await pglite.exec(
    "DELETE FROM automation_run_history; DELETE FROM chat_threads",
  );
});

describe("automation chat source backfill", () => {
  it("dry-runs and tags only untagged threads with one recorded app", async () => {
    await pglite.exec(`
      INSERT INTO chat_threads VALUES
        ('calendar-thread', 'alice@example.com', NULL),
        ('ambiguous-thread', 'alice@example.com', NULL),
        ('already-tagged', 'alice@example.com', 'mail'),
        ('legacy-thread', 'alice@example.com', NULL),
        ('private-thread', 'bob@example.com', NULL);
      INSERT INTO automation_run_history VALUES
        ('calendar-run-1', 'alice@example.com', 'calendar-thread', 'calendar'),
        ('calendar-run-2', 'alice@example.com', 'calendar-thread', 'calendar'),
        ('ambiguous-run-1', 'alice@example.com', 'ambiguous-thread', 'calendar'),
        ('ambiguous-run-2', 'alice@example.com', 'ambiguous-thread', 'slides'),
        ('tagged-run', 'alice@example.com', 'already-tagged', 'calendar'),
        ('legacy-run', 'alice@example.com', 'legacy-thread', NULL),
        ('foreign-run', 'alice@example.com', 'private-thread', 'calendar');
    `);

    expect(await backfillAutomationChatSources(db)).toEqual({
      untaggedAutomationThreads: 3,
      eligibleThreads: 1,
      ambiguousThreads: 1,
      unattributedThreads: 1,
      updatedThreads: 0,
    });
    expect(
      (await pglite.query("SELECT * FROM chat_threads ORDER BY id")).rows,
    ).toEqual([
      {
        id: "already-tagged",
        owner_email: "alice@example.com",
        source_app_id: "mail",
      },
      {
        id: "ambiguous-thread",
        owner_email: "alice@example.com",
        source_app_id: null,
      },
      {
        id: "calendar-thread",
        owner_email: "alice@example.com",
        source_app_id: null,
      },
      {
        id: "legacy-thread",
        owner_email: "alice@example.com",
        source_app_id: null,
      },
      {
        id: "private-thread",
        owner_email: "bob@example.com",
        source_app_id: null,
      },
    ]);

    expect(await backfillAutomationChatSources(db, { apply: true })).toEqual({
      untaggedAutomationThreads: 3,
      eligibleThreads: 1,
      ambiguousThreads: 1,
      unattributedThreads: 1,
      updatedThreads: 1,
    });
    expect(
      (await pglite.query("SELECT * FROM chat_threads ORDER BY id")).rows,
    ).toEqual([
      {
        id: "already-tagged",
        owner_email: "alice@example.com",
        source_app_id: "mail",
      },
      {
        id: "ambiguous-thread",
        owner_email: "alice@example.com",
        source_app_id: null,
      },
      {
        id: "calendar-thread",
        owner_email: "alice@example.com",
        source_app_id: "calendar",
      },
      {
        id: "legacy-thread",
        owner_email: "alice@example.com",
        source_app_id: null,
      },
      {
        id: "private-thread",
        owner_email: "bob@example.com",
        source_app_id: null,
      },
    ]);
    expect(
      (await backfillAutomationChatSources(db, { apply: true })).updatedThreads,
    ).toBe(0);
  });
});
