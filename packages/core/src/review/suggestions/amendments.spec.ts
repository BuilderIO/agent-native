import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let sqlite: Database.Database;
const client = {
  execute: async (input: string | { sql: string; args?: unknown[] }) => {
    const sql = typeof input === "string" ? input : input.sql;
    const args = typeof input === "string" ? [] : (input.args ?? []);
    if (/^\s*(SELECT|PRAGMA)/i.test(sql)) {
      return { rows: sqlite.prepare(sql).all(...args), rowsAffected: 0 };
    }
    return { rows: [], rowsAffected: sqlite.prepare(sql).run(...args).changes };
  },
  transaction: async <T>(
    run: (tx: typeof client) => Promise<T>,
  ): Promise<T> => {
    sqlite.exec("BEGIN");
    try {
      const result = await run(client);
      sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  },
};
const access = vi.fn(async () => ({
  role: "commenter",
  ownerEmail: "owner@example.com",
}));
const validate = vi.fn();
const apply = vi.fn();
vi.mock("../../db/client.js", () => ({
  getDbExec: () => client,
  isPostgres: () => false,
}));
vi.mock("../registry.js", () => ({
  assertReviewableResourceAccess: (...args: unknown[]) => access(...args),
}));
vi.mock("../notifications.js", () => ({ notifyReviewComment: vi.fn() }));
vi.mock("../store.js", () => ({
  ensureReviewTables: vi.fn(),
  insertReviewCommentWithClient: vi.fn(),
  resolveReviewThreadWithClient: vi.fn(),
}));
vi.mock("./registry.js", () => ({
  getSuggestionAdapter: () => ({
    kind: "test",
    version: 1,
    validateProposal: validate,
    apply,
  }),
}));

const { updateResourceSuggestion, decideResourceSuggestion } =
  await import("./actions.js");
const {
  insertSuggestion,
  getSuggestion,
  ensureSuggestionTables,
  __resetSuggestionTablesForTests,
  amendSuggestion,
  updateSuggestionStatus,
} = await import("./store.js");
const operation = {
  ordinal: 0,
  kind: "replace_text",
  before: "old",
  after: "new",
  schemaVersion: 1,
};
let suggestion: Awaited<ReturnType<typeof insertSuggestion>>;
const author = { userEmail: "author@example.com" };
const request = () => ({
  id: suggestion.id,
  observedRevision: 1,
  idempotencyKey: "amend-1",
  operations: [{ ...operation, after: "better" }],
});
const decide = (observedRevision?: number) =>
  decideResourceSuggestion.run(
    {
      id: suggestion.id,
      decision: "accepted",
      observedBase: "base-1",
      observedRevision,
      idempotencyKey: "decision-1",
    },
    author,
  );

beforeEach(async () => {
  sqlite = new Database(":memory:");
  __resetSuggestionTablesForTests();
  access
    .mockReset()
    .mockResolvedValue({ role: "commenter", ownerEmail: "owner@example.com" });
  validate.mockReset();
  apply.mockReset();
  await ensureSuggestionTables();
  suggestion = await insertSuggestion({
    resourceType: "document",
    resourceId: "doc-1",
    adapterKind: "test",
    adapterVersion: 1,
    threadId: "thread-1",
    authorEmail: author.userEmail,
    actorKind: "human",
    baseRevision: "base-1",
    status: "pending",
    summary: "Original",
    ownerEmail: "owner@example.com",
    orgId: null,
    visibility: "private",
    metadata: null,
    operations: [operation],
  });
});
afterEach(() => sqlite.close());

describe("pending suggestion amendments", () => {
  it("reuses additive schema without resetting existing proposal revisions", async () => {
    await updateResourceSuggestion.run(request(), author);
    __resetSuggestionTablesForTests();
    await ensureSuggestionTables();
    expect((await getSuggestion(suggestion.id))?.revision).toBe(2);
  });

  it("adds ownership columns to a preexisting amendment table without removing rows", async () => {
    sqlite.close();
    sqlite = new Database(":memory:");
    sqlite.exec(
      "CREATE TABLE agent_review_suggestion_amendments (idempotency_key TEXT PRIMARY KEY, suggestion_id TEXT NOT NULL, revision INTEGER NOT NULL, author_email TEXT NOT NULL, request_json TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (suggestion_id, revision))",
    );
    sqlite
      .prepare(
        "INSERT INTO agent_review_suggestion_amendments VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        "existing",
        "existing-suggestion",
        2,
        "author@example.com",
        "{}",
        "{}",
        "{}",
        "now",
      );
    __resetSuggestionTablesForTests();
    await ensureSuggestionTables();
    const row = sqlite
      .prepare(
        "SELECT * FROM agent_review_suggestion_amendments WHERE idempotency_key = ?",
      )
      .get("existing");
    expect(row).toMatchObject({
      suggestion_id: "existing-suggestion",
      revision: 2,
      owner_email: null,
      org_id: null,
      visibility: "private",
    });
  });
  it("preserves identity, increments revision and keeps append-only before/after history without applying canonical content", async () => {
    const first = await updateResourceSuggestion.run(request(), author);
    const second = await updateResourceSuggestion.run(
      {
        ...request(),
        observedRevision: 2,
        idempotencyKey: "amend-2",
        operations: [{ ...operation, after: "best" }],
      },
      author,
    );
    expect(second).toMatchObject({
      id: suggestion.id,
      threadId: suggestion.threadId,
      authorEmail: suggestion.authorEmail,
      createdAt: suggestion.createdAt,
      revision: 3,
      status: "pending",
    });
    const rows = sqlite
      .prepare(
        "SELECT before_json, after_json FROM agent_review_suggestion_amendments ORDER BY revision",
      )
      .all() as { before_json: string; after_json: string }[];
    expect(rows).toHaveLength(2);
    expect(JSON.parse(rows[0]!.before_json).operations[0].after).toBe("new");
    expect(JSON.parse(rows[0]!.after_json)).toEqual(first);
    expect(JSON.parse(rows[1]!.after_json)).toEqual(second);
    expect(apply).not.toHaveBeenCalled();
    expect(validate).toHaveBeenCalledWith(
      expect.objectContaining({
        baseRevision: "base-1",
        ctx: expect.objectContaining({ transaction: client }),
      }),
    );
  });

  it("replays an exact retry without adding history and rejects mismatched key reuse", async () => {
    const first = await updateResourceSuggestion.run(request(), author);
    expect(await updateResourceSuggestion.run(request(), author)).toEqual(
      first,
    );
    await expect(
      updateResourceSuggestion.run(
        { ...request(), summary: "Changed" },
        author,
      ),
    ).rejects.toMatchObject({ errorCode: "idempotency_conflict" });
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM agent_review_suggestion_amendments",
        )
        .get(),
    ).toEqual({ count: 1 });
  });

  it.each([{}, { userEmail: "owner@example.com" }])(
    "rejects a caller who is not the exact author: %s",
    async (caller) => {
      await expect(
        updateResourceSuggestion.run(request(), caller),
      ).rejects.toMatchObject({ errorCode: "forbidden" });
      expect((await getSuggestion(suggestion.id))?.revision).toBe(1);
    },
  );

  it("rechecks revoked access inside the transaction", async () => {
    access
      .mockResolvedValueOnce({
        role: "commenter",
        ownerEmail: "owner@example.com",
      })
      .mockRejectedValueOnce(new Error("Access revoked"));
    await expect(
      updateResourceSuggestion.run(request(), author),
    ).rejects.toThrow("Access revoked");
    expect((await getSuggestion(suggestion.id))?.revision).toBe(1);
  });

  it("rejects a stale proposal revision without replacing content", async () => {
    await updateResourceSuggestion.run(request(), author);
    await expect(
      updateResourceSuggestion.run(
        { ...request(), idempotencyKey: "other" },
        author,
      ),
    ).rejects.toMatchObject({ errorCode: "suggestion_conflict" });
    expect((await getSuggestion(suggestion.id))?.operations[0]?.after).toBe(
      "better",
    );
  });

  it("rejects changed canonical basis through adapter validation without an amendment", async () => {
    validate.mockRejectedValueOnce(new Error("Canonical changed"));
    await expect(
      updateResourceSuggestion.run(request(), author),
    ).rejects.toThrow("Canonical changed");
    expect((await getSuggestion(suggestion.id))?.revision).toBe(1);
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM agent_review_suggestion_amendments",
        )
        .get(),
    ).toEqual({ count: 0 });
  });

  it("rejects missing/stale decision revision after amendment and accepts the observed revision", async () => {
    await updateResourceSuggestion.run(request(), author);
    await expect(decide()).rejects.toMatchObject({
      errorCode: "suggestion_conflict",
    });
    await expect(decide(1)).rejects.toMatchObject({
      errorCode: "suggestion_conflict",
    });
    expect(apply).not.toHaveBeenCalled();
    await decide(2);
    expect(apply).toHaveBeenCalledOnce();
    expect((await getSuggestion(suggestion.id))?.status).toBe("accepted");
  });

  it("refuses an amendment after acceptance, while legacy revision-one decisions still work", async () => {
    await decide();
    await expect(
      updateResourceSuggestion.run(request(), author),
    ).rejects.toMatchObject({ errorCode: "suggestion_conflict" });
    expect((await getSuggestion(suggestion.id))?.revision).toBe(1);
  });

  it("CAS refuses a decision based on an amendment's previous revision", async () => {
    await updateResourceSuggestion.run(request(), author);
    expect(
      await updateSuggestionStatus(client, suggestion.id, "accepted", 1),
    ).toBe(false);
    expect((await getSuggestion(suggestion.id))?.status).toBe("pending");
  });

  it("CAS refuses amendment if a decision wins after the author reads", async () => {
    await decide();
    expect(
      await client.transaction((tx) =>
        amendSuggestion(tx, suggestion, [operation], "Other", "late", "{}"),
      ),
    ).toBeNull();
    expect((await getSuggestion(suggestion.id))?.status).toBe("accepted");
  });

  it("rolls the payload and revision back when the history receipt cannot be written", async () => {
    await updateResourceSuggestion.run(request(), author);
    const current = (await getSuggestion(suggestion.id))!;
    await expect(
      client.transaction((tx) =>
        amendSuggestion(tx, current, [operation], "Bad", "amend-1", "{}"),
      ),
    ).rejects.toThrow();
    expect(await getSuggestion(suggestion.id)).toEqual(current);
  });
});
