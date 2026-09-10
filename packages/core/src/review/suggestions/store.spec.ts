import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../../a2a/test-pglite.js";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      await pglite.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const result = await pglite.query(input.sql, input.args ?? []);
    return {
      rows: Array.from(result.rows ?? []),
      rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
    };
  }),
  transaction: async <T>(fn: (tx: typeof rawClient) => Promise<T>) => {
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
  listSuggestions,
  getSuggestionByCreationKey,
  recordSuggestionCreation,
  amendSuggestion,
  recordDecision,
  __resetSuggestionTablesForTests,
} = await import("./store.js");

beforeEach(async () => {
  pglite = await createTestPglite();
  __resetSuggestionTablesForTests();
  await ensureSuggestionTables();
});
afterEach(async () => {
  await pglite.close();
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

  it("keeps the original creation result and converges a competing receipt", async () => {
    const original = await insertSuggestion(input);
    const request = '{"request":"original"}';
    await recordSuggestionCreation(
      rawClient,
      "create-key",
      original,
      original.authorEmail,
      original.actorKind,
      request,
    );
    const competing = await insertSuggestion({
      ...input,
      threadId: "thread-2",
    });
    const winner = await recordSuggestionCreation(
      rawClient,
      "create-key",
      competing,
      competing.authorEmail,
      competing.actorKind,
      request,
    );
    expect(winner.suggestion.id).toBe(original.id);

    await rawClient.transaction((tx) =>
      amendSuggestion(
        tx,
        original,
        [{ ...input.operations[0], after: "amended" }],
        "Amended",
        "amend-key",
        '{"request":"amend"}',
      ),
    );
    expect(
      (await getSuggestionByCreationKey(rawClient, "create-key"))?.suggestion,
    ).toEqual(original);
  });

  it("loads complete suggestion operations in one resource-scoped query", async () => {
    await insertSuggestion(input);
    await insertSuggestion({
      ...input,
      threadId: "thread-2",
      summary: "Second suggestion",
      operations: [{ ...input.operations[0], ordinal: 1, after: "newer" }],
    });
    rawClient.execute.mockClear();

    const suggestions = await listSuggestions(
      input.resourceType,
      input.resourceId,
      ["pending"],
    );

    expect(suggestions).toHaveLength(2);
    expect(
      suggestions.map((suggestion) => suggestion.operations[0]?.after),
    ).toEqual(["new", "newer"]);
    expect(rawClient.execute).toHaveBeenCalledOnce();
  });
});
