import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec, getDbExec } from "@agent-native/core/db";
import type { EmbeddingFamily } from "@agent-native/core/embeddings";
import {
  configureSemanticSearch,
  drainSemanticIndex,
  forgetSemanticSearchForOrg,
  requeueSemanticSearchForOrg,
  writeSemanticSearchSetting,
} from "@agent-native/core/search";
import { runWithRequestContext } from "@agent-native/core/server";
import { createMemorySearchVectorStore } from "@agent-native/core/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Hybrid search merges the top word and meaning matches, then lists the
// remaining word matches. Meaning matches are checked against the same
// access rules and filters as word matches, and paging reaches every
// result exactly once.

const TEST_DB_PATH = join(
  tmpdir(),
  `content-search-hybrid-${process.pid}-${Date.now()}.pglite`,
);
const ORG = "org-hybrid";
const OWNER = "owner@hybrid.example";
const READER = "reader@hybrid.example";
const STRANGER = "stranger@hybrid.example";

type Schema = typeof import("../server/db/schema.js");
let getDb: typeof import("../server/db/index.js").getDb;
let schema: Schema;
let documentSearchIndex: typeof import("../server/db/index.js").documentSearchIndex;
let searchDocuments: typeof import("./search-documents.js").default;

/** Words that mean the same thing share a dimension, as a real model would. */
const CONCEPTS = [
  ["refund", "refunds", "money", "reimbursed", "reimburse", "reimbursement"],
  ["vacation", "holiday", "leave"],
  // Support notes are mostly about support, so they sit further from a
  // question about refunds than the refund policy does.
  ["support", "request", "case"],
];

const family: EmbeddingFamily = {
  id: "fake-concepts",
  provider: "fake",
  model: "fake-concepts-1",
  version: "1",
  dimensions: CONCEPTS.length + 1,
  async embed(inputs) {
    return inputs.map((input) => {
      const words = (input.text ?? "").toLowerCase().split(/[^a-z]+/);
      return [
        ...CONCEPTS.map(
          (group) => words.filter((word) => group.includes(word)).length,
        ),
        0.01,
      ];
    });
  },
};

const store = createMemorySearchVectorStore();
const NOTE_COUNT = 25;

async function drainEmbeddings() {
  await getDbExec().execute(
    `UPDATE app_resource_changes SET changed_at = changed_at - interval '5 minutes'
     WHERE consumer = 'search-embeddings'`,
  );
  await drainSemanticIndex(documentSearchIndex, Date.now() + 30_000);
}

type SearchArgs = Partial<Parameters<typeof searchDocuments.run>[0]>;

function search(args: SearchArgs) {
  return runWithRequestContext({ userEmail: READER, orgId: ORG }, () =>
    searchDocuments.run({
      limit: 20,
      offset: 0,
      ...args,
    } as Parameters<typeof searchDocuments.run>[0]),
  );
}

/** Follows nextOffset to the end, returning every page. */
async function allPages(args: SearchArgs) {
  const pages = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const page = await search({ ...args, offset });
    pages.push(page);
    offset = page.pagination.nextOffset;
    if (pages.length > 50) throw new Error("Paging never ended.");
  }
  return pages;
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  documentSearchIndex = dbModule.documentSearchIndex;
  searchDocuments = (await import("./search-documents.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at BIGINT NOT NULL,
    identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at BIGINT NOT NULL,
    federation_removal_pending_at BIGINT
  )`);
  await getDbExec().execute({
    sql: "INSERT INTO organizations (id, name, created_by, created_at) VALUES ($1, $2, $3, $4)",
    args: [ORG, "Hybrid", OWNER, Date.now()],
  });
  for (const [index, email] of [OWNER, READER, STRANGER].entries()) {
    await getDbExec().execute({
      sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ($1, $2, $3, $4, $5)",
      args: [`m${index}`, ORG, email, "member", Date.now()],
    });
  }

  configureSemanticSearch({
    vectorStore: store,
    resolveEmbeddingFamily: async () => family,
  });

  const start = Date.UTC(2026, 0, 1);
  const shared = { orgId: ORG, visibility: "org" as const };
  await getDb()
    .insert(schema.documents)
    .values(
      [
        ...Array.from({ length: NOTE_COUNT }, (_, index) => ({
          id: `note-${String(index).padStart(2, "0")}`,
          title: `Support note ${index}`,
          content: `A money back request, case ${index}.`,
          ownerEmail: OWNER,
          ...shared,
        })),
        {
          id: "refund-policy",
          title: "Refund policy",
          content: "Customers are reimbursed within a week.",
          ownerEmail: OWNER,
          ...shared,
        },
        {
          id: "private-refunds",
          title: "Refunds I owe",
          content: "Reimburse the team.",
          ownerEmail: STRANGER,
          orgId: ORG,
          visibility: "private" as const,
        },
        {
          // A member's personal space, embedded through the organization's
          // provider, so its switch covers this page too.
          id: "personal-refunds",
          title: "My refunds",
          content: "Reimburse my flight.",
          ownerEmail: OWNER,
          orgId: null,
          visibility: "private" as const,
        },
        {
          id: "hidden-refunds",
          title: "Refund drafts",
          content: "Reimbursed cases.",
          ownerEmail: OWNER,
          hideFromSearch: 1,
          ...shared,
        },
        {
          id: "vacation",
          title: "Vacation",
          content: "Holiday requests go to your manager.",
          ownerEmail: OWNER,
          ...shared,
        },
      ].map((document, index) => ({
        description: "",
        ...document,
        updatedAt: new Date(start + index * 60_000).toISOString(),
      })),
    );
  await drainEmbeddings();
}, 60_000);

afterAll(async () => {
  configureSemanticSearch({});
  await closeDbExec();
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("hybrid search", () => {
  it("finds a page by meaning, beside the pages that share the words", async () => {
    const result = await search({ query: "money back" });
    expect(result.semanticSearch).toEqual({ status: "used" });
    const policy = result.documents.find((doc) => doc.id === "refund-policy");
    expect(policy?.matchedBy).toBe("meaning");
    expect(
      result.documents.find((doc) => doc.id.startsWith("note-"))?.matchedBy,
    ).toBe("both");
    expect(result.documents.map((doc) => doc.id)).not.toContain("vacation");
  });

  it("never returns a meaning match the reader can't open or that is hidden from search", async () => {
    const ids = (await allPages({ query: "money back", limit: 50 })).flatMap(
      (page) => page.documents.map((doc) => doc.id),
    );
    expect(ids).not.toContain("private-refunds");
    expect(ids).not.toContain("hidden-refunds");
  });

  it("reaches every match exactly once through Show more", async () => {
    const pages = await allPages({ query: "money back", limit: 7 });
    const ids = pages.flatMap((page) => page.documents.map((doc) => doc.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(
      new Set([
        "refund-policy",
        ...Array.from(
          { length: NOTE_COUNT },
          (_, index) => `note-${String(index).padStart(2, "0")}`,
        ),
      ]),
    );
    for (const page of pages) {
      expect(page.pagination.totalItems).toBe(NOTE_COUNT + 1);
    }
    // Word matches past the fused ones say how they matched too.
    expect(
      pages[pages.length - 1]?.documents.every((doc) => doc.matchedBy),
    ).toBe(true);
  });

  it("matches words only when asked, or for operators and title searches", async () => {
    const words = await search({ query: "money back", mode: "words" });
    expect(words.semanticSearch).toEqual({
      status: "skipped",
      reason: "words-mode",
    });
    expect(words.documents.map((doc) => doc.id)).not.toContain("refund-policy");
    expect(words.pagination.totalItems).toBe(NOTE_COUNT);
    expect(words.documents.every((doc) => doc.matchedBy === undefined)).toBe(
      true,
    );

    expect((await search({ query: '"money back"' })).semanticSearch).toEqual({
      status: "skipped",
      reason: "operators",
    });
    expect(
      (await search({ query: "refund", searchFields: "title" })).semanticSearch,
    ).toEqual({ status: "skipped", reason: "title-only" });
  });

  it("finds a page by meaning when no page has the words", async () => {
    const result = await search({ query: "reimbursement timing" });
    expect(result.documents[0]?.id).toBe("refund-policy");
    expect(result.documents[0]?.matchedBy).toBe("meaning");
  });

  it("matches words only, and says so, once the organization turns it off", async () => {
    expect(store.keys()).toContain("content/document/personal-refunds/0");
    await writeSemanticSearchSetting(ORG, { enabled: false, updatedBy: OWNER });
    await forgetSemanticSearchForOrg(ORG);
    try {
      const result = await search({ query: "money back" });
      expect(result.semanticSearch).toEqual({ status: "off" });
      expect(result.documents.map((doc) => doc.id)).not.toContain(
        "refund-policy",
      );
      expect(result.pagination.totalItems).toBe(NOTE_COUNT);
      expect(store.keys()).toEqual([]);
    } finally {
      await writeSemanticSearchSetting(ORG, {
        enabled: true,
        updatedBy: OWNER,
      });
      await requeueSemanticSearchForOrg(ORG);
      await drainEmbeddings();
    }
    expect((await search({ query: "money back" })).semanticSearch).toEqual({
      status: "used",
    });
  });
});
