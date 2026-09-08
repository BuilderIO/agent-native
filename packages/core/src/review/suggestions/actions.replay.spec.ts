import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ResourceSuggestion } from "./types.js";

const transaction = { execute: vi.fn() };
const validateProposal = vi.fn();
const insertSuggestion = vi.fn();
let prior: ResourceSuggestion | null;
let requestFingerprint: string | null;

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
  getSuggestion: vi.fn(),
  getSuggestionByCreationKey: vi.fn(async () =>
    prior ? { suggestion: prior, requestFingerprint } : null,
  ),
  insertSuggestion,
  listSuggestions: vi.fn(),
  recordDecision: vi.fn(),
  getDecision: vi.fn(),
  recordSuggestionCreation: vi.fn(),
  replaceSuggestionStatus: vi.fn(),
  updateSuggestionStatus: vi.fn(),
}));

const { createResourceSuggestion } = await import("./actions.js");
const { __resetReviewableResourcesForTests, registerReviewableResource } =
  await import("../registry.js");
const { __resetSuggestionAdaptersForTests, registerSuggestionAdapter } =
  await import("./registry.js");

const operations = [
  {
    ordinal: 0,
    kind: "replace_text",
    after: { text: "new", marks: ["bold"] },
    schemaVersion: 1,
  },
];
const args = {
  resourceType: "doc",
  resourceId: "doc-1",
  adapterKind: "test.adapter",
  baseRevision: "revision-1",
  summary: "Replace text",
  idempotencyKey: "creation-1",
  metadata: { source: "agent", nested: { z: 1, a: 2 } },
  operations,
};

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(",")}}`;
}

async function replayRequestFingerprint(): Promise<string> {
  const requestJson = stableJson({
    resourceType: args.resourceType,
    resourceId: args.resourceId,
    adapterKind: args.adapterKind,
    baseRevision: args.baseRevision,
    summary: args.summary,
    metadata: args.metadata,
    authorEmail: "agent@example.com",
    actorKind: "agent",
    operations: [
      {
        ordinal: 0,
        kind: "replace_text",
        targetId: null,
        before: null,
        after: { text: "new", marks: ["bold"] },
        anchor: null,
        dependencies: null,
        schemaVersion: 1,
      },
    ],
  });
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(requestJson),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function makePrior(): ResourceSuggestion {
  return {
    id: "suggestion-1",
    resourceType: args.resourceType,
    resourceId: args.resourceId,
    adapterKind: args.adapterKind,
    adapterVersion: 1,
    threadId: "thread-1",
    authorEmail: "agent@example.com",
    actorKind: "agent",
    baseRevision: args.baseRevision,
    status: "accepted",
    summary: args.summary,
    ownerEmail: "owner@example.com",
    orgId: null,
    visibility: "private",
    createdAt: "earlier",
    updatedAt: "later",
    metadata: { nested: { a: 2, z: 1 }, source: "agent" },
    operations: [
      {
        id: "stored-operation-1",
        ordinal: 0,
        kind: "replace_text",
        targetId: null,
        before: null,
        after: { marks: ["bold"], text: "new" },
        anchor: null,
        dependencies: null,
        schemaVersion: 1,
      },
    ],
  };
}

describe("suggestion creation replay", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    prior = makePrior();
    requestFingerprint = await replayRequestFingerprint();
    validateProposal.mockRejectedValue(
      new Error("base revision is no longer current"),
    );
    __resetReviewableResourcesForTests();
    __resetSuggestionAdaptersForTests();
    registerReviewableResource({
      type: "doc",
      resolveAccess: () => ({
        role: "commenter",
        ownerEmail: "owner@example.com",
        visibility: "private",
      }),
    });
    registerSuggestionAdapter({
      kind: "test.adapter",
      version: 1,
      validateProposal,
      apply: vi.fn(),
    });
  });

  it("refuses creation when commenter access was revoked inside the transaction", async () => {
    prior = null;
    registerReviewableResource({
      type: "doc",
      resolveAccess: (_id, ctx) => ({
        role: ctx?.transaction ? "viewer" : "commenter",
        ownerEmail: "owner@example.com",
        visibility: "private",
      }),
    });
    await expect(
      createResourceSuggestion.run(args, {
        caller: "tool",
        userEmail: "agent@example.com",
      }),
    ).rejects.toThrow("Not allowed");
    expect(insertSuggestion).not.toHaveBeenCalled();
  });

  it("passes the active transaction to proposal validation", async () => {
    prior = null;
    await expect(
      createResourceSuggestion.run(args, {
        caller: "tool",
        userEmail: "agent@example.com",
      }),
    ).rejects.toThrow("base revision");
    expect(validateProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx: expect.objectContaining({ transaction }),
      }),
    );
  });

  it("returns the original accepted suggestion before mutable validation", async () => {
    await expect(
      createResourceSuggestion.run(args, {
        caller: "tool",
        userEmail: "agent@example.com",
      }),
    ).resolves.toEqual(prior);
    expect(validateProposal).not.toHaveBeenCalled();
    expect(insertSuggestion).not.toHaveBeenCalled();
  });

  it("replays from the pre-validation payload when the adapter transformed operations", async () => {
    prior = {
      ...makePrior(),
      operations: [
        {
          ordinal: 0,
          kind: "replace_text",
          after: { normalizedText: "new" },
          schemaVersion: 2,
        },
      ],
    };
    await expect(
      createResourceSuggestion.run(args, {
        caller: "tool",
        userEmail: "agent@example.com",
      }),
    ).resolves.toEqual(prior);
    expect(validateProposal).not.toHaveBeenCalled();
  });

  it.each([
    ["resource", { resourceId: "doc-2" }],
    ["adapter", { adapterKind: "other.adapter" }],
    ["base revision", { baseRevision: "revision-2" }],
    ["summary", { summary: "Different summary" }],
    ["metadata", { metadata: { source: "human" } }],
    ["operations", { operations: [{ ...operations[0], kind: "delete" }] }],
  ])("rejects replay with changed %s", async (_field, changed) => {
    await expect(
      createResourceSuggestion.run(
        { ...args, ...changed },
        { caller: "tool", userEmail: "agent@example.com" },
      ),
    ).rejects.toThrow(
      "Idempotency key was already used for a different suggestion",
    );
    expect(validateProposal).not.toHaveBeenCalled();
  });

  it("rejects replay from a different author", async () => {
    await expect(
      createResourceSuggestion.run(args, {
        caller: "tool",
        userEmail: "other-agent@example.com",
      }),
    ).rejects.toThrow(
      "Idempotency key was already used for a different suggestion",
    );
    expect(validateProposal).not.toHaveBeenCalled();
  });

  it("rejects replay from a different actor kind", async () => {
    await expect(
      createResourceSuggestion.run(args, {
        caller: "frontend",
        userEmail: "agent@example.com",
      }),
    ).rejects.toThrow(
      "Idempotency key was already used for a different suggestion",
    );
    expect(validateProposal).not.toHaveBeenCalled();
  });
});
