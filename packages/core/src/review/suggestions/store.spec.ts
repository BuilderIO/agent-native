import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../../a2a/test-pglite.js";
import type { DbExec } from "../../db/client.js";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;

async function execute(input: string | { sql: string; args?: unknown[] }) {
  if (typeof input === "string") {
    await pglite.exec(input);
    return { rows: [], rowsAffected: 0 };
  }
  const result = await pglite.query(input.sql, input.args ?? []);
  return {
    rows: Array.from(result.rows ?? []),
    rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
  };
}

type TransactionalTestClient = DbExec & {
  transaction<T>(fn: (tx: DbExec) => Promise<T>): Promise<T>;
};

const rawClient: TransactionalTestClient = {
  execute: vi.fn(execute),
  transaction: async <T>(fn: (tx: DbExec) => Promise<T>) => {
    await pglite.exec("BEGIN");
    try {
      const result = await fn(rawClient);
      await pglite.exec("COMMIT");
      return result;
    } catch (error) {
      await pglite.exec("ROLLBACK");
      throw error;
    }
  },
};
vi.mock("../../db/client.js", () => ({
  getDbExec: () => rawClient,
  isProductionServerlessFunctionRuntime: () => false,
}));
const {
  ensureSuggestionTables,
  insertSuggestion,
  getSuggestion,
  getSuggestionByCreationKey,
  recordSuggestionCreation,
  recordDecision,
  __resetSuggestionTablesForTests,
} = await import("./store.js");

beforeEach(async () => {
  pglite = await createTestPglite();
  rawClient.execute.mockClear();
  __resetSuggestionTablesForTests();
  await ensureSuggestionTables();
});
afterEach(async () => {
  await pglite.close();
  vi.clearAllMocks();
});

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

  it("retains the pre-validation request for keyed creation replay", async () => {
    const suggestion = await insertSuggestion(input);
    await recordSuggestionCreation(
      rawClient,
      "creation-key-1",
      suggestion.id,
      '{"operations":[{"kind":"replace_text"}]}',
    );
    const creation = await getSuggestionByCreationKey(
      rawClient,
      "creation-key-1",
    );
    expect(creation?.suggestion.id).toBe(suggestion.id);
    expect(creation?.suggestion.operations[0]).toMatchObject(
      suggestion.operations[0],
    );
    expect(creation?.requestFingerprint).toBe(
      '{"operations":[{"kind":"replace_text"}]}',
    );
  });
});
