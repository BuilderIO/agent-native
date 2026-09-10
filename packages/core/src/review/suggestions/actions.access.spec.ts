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
  revision: 1,
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
  deleteUnclaimedSuggestion: vi.fn(),
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

const createArgs = {
  resourceType: suggestion.resourceType,
  resourceId: suggestion.resourceId,
  adapterKind: suggestion.adapterKind,
  baseRevision: suggestion.baseRevision,
  summary: suggestion.summary,
  idempotencyKey: "create-1",
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
};
const createRequest = JSON.stringify({
  adapterKind: createArgs.adapterKind,
  baseRevision: createArgs.baseRevision,
  metadata: null,
  operations: [
    {
      after: "Proposed",
      before: "Original",
      kind: "replace_text",
      ordinal: 0,
      schemaVersion: 1,
      targetId: "body",
    },
  ],
  resourceId: createArgs.resourceId,
  resourceType: createArgs.resourceType,
  summary: createArgs.summary,
});
const createRequestHash = Array.from(
  new Uint8Array(
    await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(createRequest),
    ),
  ),
  (byte) => byte.toString(16).padStart(2, "0"),
).join("");
const creationReceipt = {
  suggestion,
  authorEmail: suggestion.authorEmail,
  actorKind: suggestion.actorKind,
  requestHash: createRequestHash,
};

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
    validateProposal.mockReset();
    applySuggestion.mockReset();
    vi.mocked(suggestionStore.getSuggestion)
      .mockReset()
      .mockResolvedValue(suggestion);
    vi.mocked(suggestionStore.getSuggestionByCreationKey)
      .mockReset()
      .mockResolvedValue(null);
    vi.mocked(suggestionStore.insertSuggestion).mockReset();
    vi.mocked(suggestionStore.recordSuggestionCreation).mockReset();
    vi.mocked(suggestionStore.deleteUnclaimedSuggestion).mockReset();
    vi.mocked(suggestionStore.getDecision).mockReset();
    vi.mocked(suggestionStore.recordDecision).mockReset();
    updateSuggestionStatus.mockReset();
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

  it("replays the original creation receipt before canonical validation", async () => {
    vi.mocked(suggestionStore.getSuggestionByCreationKey).mockResolvedValueOnce(
      creationReceipt,
    );
    validateProposal.mockRejectedValueOnce(new Error("Canonical changed"));

    await expect(
      createResourceSuggestion.run(createArgs, {
        userEmail: suggestion.authorEmail,
      }),
    ).resolves.toEqual(suggestion);

    expect(validateProposal).not.toHaveBeenCalled();
    expect(suggestionStore.insertSuggestion).not.toHaveBeenCalled();
  });

  it("rejects creation-key replay by a different caller or request", async () => {
    vi.mocked(suggestionStore.getSuggestionByCreationKey).mockResolvedValue(
      creationReceipt,
    );

    await expect(
      createResourceSuggestion.run(createArgs, {
        userEmail: "other@example.com",
      }),
    ).rejects.toThrow("different suggestion");
    await expect(
      createResourceSuggestion.run(
        { ...createArgs, summary: "Different request" },
        { userEmail: suggestion.authorEmail },
      ),
    ).rejects.toThrow("different suggestion");
    expect(validateProposal).not.toHaveBeenCalled();
  });

  it("returns the winning receipt and removes its unclaimed duplicate after a creation race", async () => {
    const duplicate = { ...suggestion, id: "suggestion-duplicate" };
    vi.mocked(suggestionStore.getSuggestionByCreationKey).mockResolvedValueOnce(
      null,
    );
    vi.mocked(suggestionStore.insertSuggestion).mockResolvedValueOnce(
      duplicate,
    );
    vi.mocked(suggestionStore.recordSuggestionCreation).mockResolvedValueOnce(
      creationReceipt,
    );
    validateProposal.mockResolvedValueOnce(createArgs.operations);

    await expect(
      createResourceSuggestion.run(createArgs, {
        userEmail: suggestion.authorEmail,
      }),
    ).resolves.toEqual(suggestion);

    expect(suggestionStore.deleteUnclaimedSuggestion).toHaveBeenCalledWith(
      transaction,
      duplicate.id,
    );
    expect(reviewStore.insertReviewCommentWithClient).not.toHaveBeenCalled();
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

  it("returns the recorded same-key decision when it loses the status CAS", async () => {
    const decided = { ...suggestion, status: "accepted" as const };
    const decision = {
      id: "decision-1",
      suggestionId: suggestion.id,
      idempotencyKey: "decision-1",
      reviewer: "editor@example.com",
      decision: "accepted" as const,
      observedBase: suggestion.baseRevision,
      outcome: "accepted",
      detail: null,
      createdAt: "now",
    };
    registerReviewableResource({
      type: "doc",
      resolveAccess: () => ({
        role: "editor",
        ownerEmail: "owner@example.com",
        visibility: "private",
      }),
    });
    vi.mocked(suggestionStore.getSuggestion)
      .mockResolvedValueOnce(suggestion)
      .mockResolvedValueOnce(suggestion)
      .mockResolvedValueOnce(decided);
    updateSuggestionStatus.mockResolvedValueOnce(false);
    vi.mocked(suggestionStore.getDecision).mockResolvedValueOnce(decision);

    await expect(
      decideResourceSuggestion.run(
        {
          id: suggestion.id,
          decision: "accepted",
          idempotencyKey: decision.idempotencyKey,
          observedBase: suggestion.baseRevision,
          observedRevision: suggestion.revision,
        },
        { userEmail: decision.reviewer },
      ),
    ).resolves.toEqual({ suggestion: decided, decision });
    expect(suggestionStore.recordDecision).not.toHaveBeenCalled();
    expect(applySuggestion).not.toHaveBeenCalled();
  });

  it("returns the recorded same-key stale decision when it loses the status CAS", async () => {
    const stale = { ...suggestion, status: "stale" as const };
    const decision = {
      id: "decision-stale",
      suggestionId: suggestion.id,
      idempotencyKey: "decision-stale",
      reviewer: "editor@example.com",
      decision: "accepted" as const,
      observedBase: "revision-before-refresh",
      outcome: "stale",
      detail: "Base revision changed",
      createdAt: "now",
    };
    registerReviewableResource({
      type: "doc",
      resolveAccess: () => ({
        role: "editor",
        ownerEmail: "owner@example.com",
        visibility: "private",
      }),
    });
    vi.mocked(suggestionStore.getSuggestion)
      .mockResolvedValueOnce(suggestion)
      .mockResolvedValueOnce(suggestion)
      .mockResolvedValueOnce(stale);
    updateSuggestionStatus.mockResolvedValueOnce(false);
    vi.mocked(suggestionStore.getDecision).mockResolvedValueOnce(decision);

    await expect(
      decideResourceSuggestion.run(
        {
          id: suggestion.id,
          decision: "accepted",
          idempotencyKey: decision.idempotencyKey,
          observedBase: decision.observedBase,
          observedRevision: suggestion.revision,
        },
        { userEmail: decision.reviewer },
      ),
    ).resolves.toEqual({ suggestion: stale, decision });
    expect(suggestionStore.recordDecision).not.toHaveBeenCalled();
    expect(applySuggestion).not.toHaveBeenCalled();
  });
});
