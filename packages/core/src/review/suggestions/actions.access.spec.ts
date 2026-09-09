import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../../a2a/test-pglite.js";
import type { ReviewResourceContext } from "../types.js";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
const transaction = {
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
};
const client = {
  transaction: vi.fn(async <T>(run: (tx: typeof transaction) => Promise<T>) => {
    await pglite.exec("BEGIN");
    try {
      const result = await run(transaction);
      await pglite.exec("COMMIT");
      return result;
    } catch (error) {
      await pglite.exec("ROLLBACK");
      throw error;
    }
  }),
};
const updateSuggestionStatus = vi.fn();
const applySuggestion = vi.fn();
const validateProposal = vi.fn();
const suggestion = {
  id: "suggestion-1",
  resourceType: "doc",
  resourceId: "doc-1",
  adapterKind: "test.adapter",
  adapterVersion: 1,
  threadId: "thread-1",
  authorEmail: "commenter@example.com",
  actorKind: "human" as const,
  baseRevision: "revision-1",
  status: "pending" as const,
  summary: "Replace text",
  ownerEmail: "owner@example.com",
  orgId: null,
  visibility: "private" as const,
  createdAt: "now",
  updatedAt: "now",
  metadata: null,
  operations: [],
};

vi.mock("../../db/client.js", () => ({
  getDbExec: () => client,
  isProductionServerlessFunctionRuntime: () => false,
}));
vi.mock("../notifications.js", () => ({ notifyReviewComment: vi.fn() }));
vi.mock("../store.js", () => ({
  ensureReviewTables: vi.fn(),
  insertReviewCommentWithClient: vi.fn(),
  resolveReviewThreadWithClient: vi.fn(),
}));
vi.mock("./store.js", () => ({
  ensureSuggestionTables: vi.fn(),
  getSuggestion: vi.fn(async () => suggestion),
  getSuggestionByCreationKey: vi.fn(),
  insertSuggestion: vi.fn(),
  listSuggestions: vi.fn(),
  recordDecision: vi.fn(),
  getDecision: vi.fn(),
  recordSuggestionCreation: vi.fn(),
  replaceSuggestionStatus: vi.fn(),
  updateSuggestionStatus,
}));

const { createResourceSuggestion, decideResourceSuggestion } =
  await import("./actions.js");
const suggestionStore = await import("./store.js");
const reviewStore = await import("../store.js");
const { __resetReviewableResourcesForTests, registerReviewableResource } =
  await import("../registry.js");
const { __resetSuggestionAdaptersForTests, registerSuggestionAdapter } =
  await import("./registry.js");

function expectNoReviewWrites() {
  expect(suggestionStore.insertSuggestion).not.toHaveBeenCalled();
  expect(suggestionStore.recordSuggestionCreation).not.toHaveBeenCalled();
  expect(suggestionStore.replaceSuggestionStatus).not.toHaveBeenCalled();
  expect(suggestionStore.updateSuggestionStatus).not.toHaveBeenCalled();
  expect(suggestionStore.recordDecision).not.toHaveBeenCalled();
  expect(reviewStore.insertReviewCommentWithClient).not.toHaveBeenCalled();
  expect(reviewStore.resolveReviewThreadWithClient).not.toHaveBeenCalled();
  expect(applySuggestion).not.toHaveBeenCalled();
  expect(transaction.execute).not.toHaveBeenCalled();
}

describe("suggestion action access", () => {
  beforeEach(async () => {
    pglite = await createTestPglite();
    vi.clearAllMocks();
    __resetReviewableResourcesForTests();
    __resetSuggestionAdaptersForTests();
    registerReviewableResource({
      type: "doc",
      resolveAccess: (_resourceId, ctx) => ({
        role: ctx?.transaction ? "viewer" : "editor",
        ownerEmail: "owner@example.com",
        visibility: "private",
      }),
    });
    registerSuggestionAdapter({
      kind: "test.adapter",
      version: 1,
      validateProposal,
      apply: applySuggestion,
    });
  });

  afterEach(async () => {
    await pglite.close();
  });

  it("denies a viewer creating a suggestion before any writes or adapter work", async () => {
    const resolveAccess = vi.fn(
      (_resourceId: string, _ctx?: ReviewResourceContext) => ({
        role: "viewer" as const,
        ownerEmail: "owner@example.com",
        visibility: "private" as const,
      }),
    );
    registerReviewableResource({ type: "doc", resolveAccess });

    await expect(
      createResourceSuggestion.run(
        {
          resourceType: suggestion.resourceType,
          resourceId: suggestion.resourceId,
          adapterKind: suggestion.adapterKind,
          baseRevision: suggestion.baseRevision,
          summary: "Replace text",
          idempotencyKey: "viewer-create-1",
          operations: [
            {
              ordinal: 0,
              kind: "replace_text",
              targetId: "body",
              before: "Original",
              after: "Proposed",
              schemaVersion: 1,
            },
          ],
        },
        { userEmail: "viewer@example.com" },
      ),
    ).rejects.toThrow("Not allowed to access doc:doc-1");

    expect(resolveAccess).toHaveBeenCalledWith(
      "doc-1",
      expect.objectContaining({ userEmail: "viewer@example.com" }),
    );
    expect(validateProposal).not.toHaveBeenCalled();
    expect(client.transaction).not.toHaveBeenCalled();
    expectNoReviewWrites();
  });

  it.each(["accepted", "rejected"] as const)(
    "denies a commenter deciding %s without changing the suggestion or canonical resource",
    async (decision) => {
      const resolveAccess = vi.fn(
        (_resourceId: string, _ctx?: ReviewResourceContext) => ({
          role: "commenter" as const,
          ownerEmail: "owner@example.com",
          visibility: "private" as const,
        }),
      );
      registerReviewableResource({ type: "doc", resolveAccess });

      await expect(
        decideResourceSuggestion.run(
          {
            id: suggestion.id,
            decision,
            idempotencyKey: `commenter-${decision}-1`,
            observedBase: suggestion.baseRevision,
          },
          { userEmail: "commenter@example.com" },
        ),
      ).rejects.toThrow("Not allowed to access doc:doc-1");

      expect(resolveAccess).toHaveBeenCalledWith(
        "doc-1",
        expect.objectContaining({ userEmail: "commenter@example.com" }),
      );
      expect(client.transaction).not.toHaveBeenCalled();
      expectNoReviewWrites();
    },
  );

  it("rechecks editor access inside the decision transaction", async () => {
    await expect(
      decideResourceSuggestion.run(
        {
          id: suggestion.id,
          decision: "accepted",
          idempotencyKey: "decision-1",
          observedBase: suggestion.baseRevision,
        },
        { userEmail: "editor@example.com" },
      ),
    ).rejects.toThrow("Not allowed to access doc:doc-1");
    expectNoReviewWrites();
  });
});
