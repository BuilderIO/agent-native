import Database from "better-sqlite3";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

let sqlite: Database.Database;
const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      sqlite.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const stmt = sqlite.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*select/i.test(input.sql))
      return { rows: stmt.all(...args), rowsAffected: 0 };
    const info = stmt.run(...args);
    return { rows: [], rowsAffected: info.changes };
  }),
  transaction: async <T>(fn: (tx: typeof rawClient) => Promise<T>) => {
    sqlite.exec("BEGIN");
    try {
      const result = await fn(rawClient);
      sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  },
};
vi.mock("../../db/client.js", () => ({
  getDbExec: () => rawClient,
  isPostgres: () => false,
}));
const {
  ensureSuggestionTables,
  insertSuggestion,
  getSuggestion,
  recordDecision,
  __resetSuggestionTablesForTests,
} = await import("./store.js");

beforeEach(async () => {
  sqlite = new Database(":memory:");
  __resetSuggestionTablesForTests();
  await ensureSuggestionTables();
});
afterEach(() => sqlite.close());

const input = {
  resourceType: "document",
  resourceId: "d1",
  adapterKind: "document",
  adapterVersion: 1,
  threadId: "thread-1",
  authorEmail: "alice@example.com",
  actorKind: "human" as const,
  baseRevision: "rev-1",
  status: "pending" as const,
  summary: "Replace text",
  ownerEmail: "alice@example.com",
  orgId: null,
  visibility: "private" as const,
  metadata: null,
  operations: [
    {
      ordinal: 0,
      kind: "replace_text",
      before: "old",
      after: "new",
      schemaVersion: 1,
    },
  ],
};

describe("suggestion store", () => {
  it("persists operations and rolls back an atomic failed insert", async () => {
    const suggestion = await rawClient.transaction((tx) =>
      insertSuggestion(input, tx),
    );
    expect((await getSuggestion(suggestion.id))?.operations[0].after).toBe(
      "new",
    );
    await expect(
      rawClient.transaction(async (tx) => {
        await insertSuggestion(input, tx);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect((await getSuggestion(suggestion.id))?.operations).toHaveLength(1);
  });

  it("records idempotent decisions and rejects conflicting key reuse", async () => {
    const suggestion = await insertSuggestion(input);
    const first = await recordDecision(rawClient, {
      suggestionId: suggestion.id,
      idempotencyKey: "key-1",
      reviewer: "editor@example.com",
      decision: "accepted",
      observedBase: "rev-1",
      outcome: "accepted",
      detail: null,
    });
    expect(first.duplicate).toBe(false);
    expect(
      (
        await recordDecision(rawClient, {
          suggestionId: suggestion.id,
          idempotencyKey: "key-1",
          reviewer: "editor@example.com",
          decision: "accepted",
          observedBase: "rev-1",
          outcome: "accepted",
          detail: null,
        })
      ).duplicate,
    ).toBe(true);
    await expect(
      recordDecision(rawClient, {
        suggestionId: "other",
        idempotencyKey: "key-1",
        reviewer: null,
        decision: "rejected",
        observedBase: "rev-1",
        outcome: "rejected",
        detail: null,
      }),
    ).rejects.toThrow("different decision");
  });
});
