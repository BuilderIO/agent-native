import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-search-within-page-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "within-owner@example.com";
const OUTSIDER = "within-outsider@example.com";
const WORD = "quokkaword";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let searchDocuments: typeof import("./search-documents.js").default;

const asUser = <T>(userEmail: string, run: () => Promise<T>) =>
  runWithRequestContext({ userEmail }, run);

const NOW = "2026-06-01T00:00:00.000Z";
const page = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  ownerEmail: OWNER,
  title: id,
  content: `${id} mentions ${WORD} here`,
  visibility: "private" as const,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const within = async (userEmail: string, pageId: string, query = WORD) => {
  const result = await asUser(userEmail, () =>
    searchDocuments.run({
      query,
      limit: 50,
      offset: 0,
      withinSubtreeOf: pageId,
    }),
  );
  return result.documents.map((document) => document.id).sort();
};

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  searchDocuments = (await import("./search-documents.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);

  await getDb()
    .insert(schema.documents)
    .values([
      page("root"),
      page("sub-page", { parentId: "root" }),
      page("deep-page", { parentId: "sub-page" }),
      page("trashed-sub-page", { parentId: "root", trashedAt: NOW }),
      page("elsewhere"),
      page("inline-collection"),
      page("inline-row"),
      page("row-child", { parentId: "inline-row" }),
      page("collection-on-sub-page", { parentId: "sub-page" }),
      page("nested-row"),
      page("other-root"),
      page("files-collection"),
      page("files-row"),
      page("shared-root"),
      page("not-shared-child", { parentId: "shared-root" }),
      page("shared-child", { parentId: "shared-root" }),
    ]);
  const collection = (
    id: string,
    documentId: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    id,
    ownerEmail: OWNER,
    documentId,
    title: id,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
  await getDb()
    .insert(schema.contentDatabases)
    .values([
      collection("inline-database", "inline-collection", {
        ownerDocumentId: "root",
        ownerBlockId: "block",
      }),
      collection("nested-database", "collection-on-sub-page"),
      collection("files-database", "files-collection", {
        ownerDocumentId: "other-root",
        ownerBlockId: "files-block",
        spaceId: "within-space",
        systemRole: "files",
      }),
    ]);
  const row = (databaseId: string, documentId: string) => ({
    id: `${databaseId}-${documentId}`,
    ownerEmail: OWNER,
    databaseId,
    documentId,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await getDb()
    .insert(schema.contentDatabaseItems)
    .values([
      row("inline-database", "inline-row"),
      row("nested-database", "nested-row"),
      row("files-database", "files-row"),
    ]);
  const share = (resourceId: string, principalId: string) => ({
    id: `share-${resourceId}-${principalId}`,
    resourceId,
    principalType: "user",
    principalId,
    role: "viewer",
    createdBy: OWNER,
    createdAt: NOW,
  });
  await getDb()
    .insert(schema.documentShares)
    .values([share("shared-root", OUTSIDER), share("shared-child", OUTSIDER)]);
}, 60_000);

afterAll(async () => {
  await closeDbExec();
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("search within a page", () => {
  it("finds the page and everything inside it, and nothing outside", async () => {
    await expect(within(OWNER, "root")).resolves.toEqual(
      [
        "collection-on-sub-page",
        "deep-page",
        "inline-collection",
        "inline-row",
        "nested-row",
        "root",
        "row-child",
        "sub-page",
      ].sort(),
    );
  });

  it("starts from any page, not just a top-level one", async () => {
    await expect(within(OWNER, "collection-on-sub-page")).resolves.toEqual(
      ["collection-on-sub-page", "nested-row"].sort(),
    );
  });

  it("doesn't reach through a workspace's Files into the workspace", async () => {
    await expect(within(OWNER, "other-root")).resolves.toEqual(["other-root"]);
  });

  it("matches titles and bodies alike, and reports only the scoped total", async () => {
    const result = await asUser(OWNER, () =>
      searchDocuments.run({
        query: "deep-page",
        limit: 50,
        offset: 0,
        withinSubtreeOf: "root",
      }),
    );
    expect(result.documents.map((document) => document.id)).toEqual([
      "deep-page",
    ]);
    expect(result.pagination.totalItems).toBe(1);
  });

  it("refuses a page the caller can't read", async () => {
    await expect(within(OUTSIDER, "root")).rejects.toThrow();
  });

  it("keeps out pages inside a shared page that the caller can't read", async () => {
    const found = await within(OUTSIDER, "shared-root");

    expect(found).toContain("shared-root");
    expect(found).toContain("shared-child");
    expect(found).not.toContain("not-shared-child");
  });
});
