import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../../a2a/test-pglite.js";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
const client = {
  execute: async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      await pglite.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const result = await pglite.query(input.sql, input.args ?? []);
    return {
      rows: Array.from(result.rows ?? []),
      rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
    };
  },
  transaction: async <T>(
    run: (tx: typeof client) => Promise<T>,
  ): Promise<T> => {
    await pglite.exec("BEGIN");
    try {
      const result = await run(client);
      await pglite.exec("COMMIT");
      return result;
    } catch (error) {
      await pglite.exec("ROLLBACK");
      throw error;
    }
  },
};
const resolveThread = vi.fn();
vi.mock("../../db/client.js", () => ({
  getDbExec: () => client,
  isProductionServerlessFunctionRuntime: () => false,
}));
vi.mock("../registry.js", () => ({
  assertReviewableResourceAccess: vi.fn(async () => ({
    role: "commenter",
    ownerEmail: "owner@example.com",
  })),
}));
vi.mock("../notifications.js", () => ({ notifyReviewComment: vi.fn() }));
vi.mock("../store.js", () => ({
  ensureReviewTables: vi.fn(),
  insertReviewCommentWithClient: vi.fn(),
  resolveReviewThreadWithClient: (...args: unknown[]) => resolveThread(...args),
}));
vi.mock("./registry.js", () => ({
  getSuggestionAdapter: () => ({
    kind: "test",
    version: 1,
    validateProposal: ({ operations }: { operations: unknown[] }) => operations,
    apply: vi.fn(),
  }),
}));

const { createResourceSuggestion } = await import("./actions.js");
const {
  insertSuggestion,
  getSuggestion,
  getDecision,
  ensureSuggestionTables,
  __resetSuggestionTablesForTests,
  updateSuggestionStatus,
} = await import("./store.js");

const author = { userEmail: "author@example.com" };
const operation = {
  ordinal: 0,
  kind: "replace_text",
  before: "old",
  after: "new",
  schemaVersion: 1,
};
const seed = (overrides: Record<string, unknown> = {}) =>
  insertSuggestion({
    resourceType: "document",
    resourceId: "doc-1",
    adapterKind: "test",
    adapterVersion: 1,
    threadId: `thread-${globalThis.crypto.randomUUID()}`,
    authorEmail: author.userEmail,
    actorKind: "human",
    baseRevision: "base-1",
    status: "pending",
    summary: "First idea",
    ownerEmail: "owner@example.com",
    orgId: null,
    visibility: "private",
    metadata: null,
    operations: [operation],
    ...overrides,
  } as Parameters<typeof insertSuggestion>[0]);
const revise = (supersedes: string[], idempotencyKey = "revision-1") =>
  createResourceSuggestion.run(
    {
      resourceType: "document",
      resourceId: "doc-1",
      adapterKind: "test",
      baseRevision: "base-1",
      summary: "Revised idea",
      idempotencyKey,
      operations: [{ ...operation, after: "newer" }],
      supersedes,
    },
    author,
  );

beforeEach(async () => {
  pglite = await createTestPglite();
  __resetSuggestionTablesForTests();
  resolveThread.mockReset();
  await ensureSuggestionTables();
});
afterEach(async () => {
  await pglite.close();
});

describe("superseding earlier suggestions", () => {
  it("marks the author's earlier pending suggestion superseded in the same step", async () => {
    const earlier = await seed();

    const revised = await revise([earlier.id]);

    expect(revised.status).toBe("pending");
    expect((await getSuggestion(earlier.id))?.status).toBe("superseded");
    expect(
      await getDecision(client, `revision-1:supersedes:${earlier.id}`),
    ).toMatchObject({
      suggestionId: earlier.id,
      decision: "superseded",
      outcome: "superseded",
      detail: revised.id,
    });
    expect(resolveThread).toHaveBeenCalledWith(
      client,
      earlier.threadId,
      author.userEmail,
      { resourceType: "document", resourceId: "doc-1" },
      "superseded",
    );
  });

  it("leaves an already decided suggestion as it was", async () => {
    const earlier = await seed();
    await updateSuggestionStatus(client, earlier.id, "rejected", 1);

    await revise([earlier.id]);

    expect((await getSuggestion(earlier.id))?.status).toBe("rejected");
    expect(
      await getDecision(client, `revision-1:supersedes:${earlier.id}`),
    ).toBeNull();
    expect(resolveThread).not.toHaveBeenCalled();
  });

  it("refuses another author's suggestion and creates nothing", async () => {
    const theirs = await seed({ authorEmail: "other@example.com" });

    await expect(revise([theirs.id])).rejects.toThrow(
      "Only the author can supersede",
    );

    expect((await getSuggestion(theirs.id))?.status).toBe("pending");
    const rows = await pglite.query(
      "SELECT COUNT(*)::int AS count FROM agent_review_suggestions",
    );
    expect(rows.rows[0]).toEqual({ count: 1 });
  });

  it("refuses a suggestion on a different resource", async () => {
    const elsewhere = await seed({ resourceId: "doc-2" });

    await expect(revise([elsewhere.id])).rejects.toThrow("not found");
    expect((await getSuggestion(elsewhere.id))?.status).toBe("pending");
  });

  it("replays an exact retry without superseding twice", async () => {
    const earlier = await seed();
    const first = await revise([earlier.id]);

    await expect(revise([earlier.id])).resolves.toMatchObject({
      id: first.id,
    });
    await expect(revise([])).rejects.toThrow("different suggestion");
    expect(resolveThread).toHaveBeenCalledTimes(1);
  });
});
