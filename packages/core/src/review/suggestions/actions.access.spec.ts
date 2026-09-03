import { beforeEach, describe, expect, it, vi } from "vitest";

const transaction = { execute: vi.fn() };
const updateSuggestionStatus = vi.fn();
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
  getDialect: () => "sqlite",
  getDbExec: () => ({
    transaction: async (run: (tx: typeof transaction) => Promise<unknown>) =>
      run(transaction),
  }),
  intType: () => "INTEGER",
  isPostgres: () => false,
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

const { decideResourceSuggestion } = await import("./actions.js");
const { __resetReviewableResourcesForTests, registerReviewableResource } =
  await import("../registry.js");
const { __resetSuggestionAdaptersForTests, registerSuggestionAdapter } =
  await import("./registry.js");

describe("suggestion decision access", () => {
  beforeEach(() => {
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
      validateProposal: () => {},
      apply: vi.fn(),
    });
  });

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
    expect(updateSuggestionStatus).not.toHaveBeenCalled();
  });
});
