import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-document-titles-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "titles-owner@example.com";
const OUTSIDER = "titles-outsider@example.com";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let listDocumentTitles: typeof import("./list-document-titles.js").default;

const asUser = <T>(userEmail: string, run: () => Promise<T>) =>
  runWithRequestContext({ userEmail }, run);

const NOW = "2026-06-01T00:00:00.000Z";
const page = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  ownerEmail: OWNER,
  title: id,
  content: `${id} body that the list must not carry`,
  visibility: "private" as const,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  listDocumentTitles = (await import("./list-document-titles.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);

  await getDb()
    .insert(schema.documents)
    .values([
      page("older", { updatedAt: "2026-01-01T00:00:00.000Z" }),
      page("newer", { updatedAt: "2026-05-01T00:00:00.000Z" }),
      page("child", { parentId: "older" }),
      page("hidden", { hideFromSearch: 1 }),
      page("trashed", { trashedAt: NOW }),
      page("someone-elses", { ownerEmail: OUTSIDER }),
      page("collection"),
      page("collection-row"),
      page("deleted-collection"),
      page("files-collection"),
      page("files-row"),
      page("outsiders-parent", { ownerEmail: OUTSIDER }),
      page("under-outsiders", { parentId: "outsiders-parent" }),
      page("outsiders-collection", { ownerEmail: OUTSIDER }),
      page("row-in-outsiders"),
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
      collection("database", "collection"),
      collection("deleted-database", "deleted-collection", { deletedAt: NOW }),
      collection("files-database", "files-collection", {
        spaceId: "titles-space",
        systemRole: "files",
      }),
      collection("outsiders-database", "outsiders-collection", {
        ownerEmail: OUTSIDER,
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
      row("database", "collection-row"),
      row("files-database", "files-row"),
      row("outsiders-database", "row-in-outsiders"),
    ]);
}, 60_000);

afterAll(async () => {
  await closeDbExec();
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("list-document-titles", () => {
  it("lists only what the caller can search, latest edited first", async () => {
    const { documents, truncated } = await asUser(OWNER, () =>
      listDocumentTitles.run({}),
    );
    const ids = documents.map((document) => document.id);

    expect(truncated).toBe(false);
    expect(ids).not.toContain("someone-elses");
    expect(ids).not.toContain("hidden");
    expect(ids).not.toContain("trashed");
    expect(ids).not.toContain("deleted-collection");
    expect(ids.indexOf("newer")).toBeLessThan(ids.indexOf("older"));
    expect(ids.indexOf("child")).toBeLessThan(ids.indexOf("newer"));

    const outsider = await asUser(OUTSIDER, () => listDocumentTitles.run({}));
    expect(outsider.documents.map((document) => document.id).sort()).toEqual([
      "outsiders-collection",
      "outsiders-parent",
      "someone-elses",
    ]);
  });

  it("carries the page's place and never its body", async () => {
    const { documents } = await asUser(OWNER, () => listDocumentTitles.run({}));
    const byId = new Map(documents.map((document) => [document.id, document]));

    expect(byId.get("child")?.parentId).toBe("older");
    expect(byId.get("collection")?.documentType).toBe("database");
    expect(byId.get("older")?.documentType).toBe("page");
    expect(byId.get("collection-row")?.collectionDocumentId).toBe("collection");
    expect(byId.get("older")).not.toHaveProperty("content");
  });

  it("doesn't treat a workspace's Files as a collection the page is inside", async () => {
    const { documents } = await asUser(OWNER, () => listDocumentTitles.run({}));
    const byId = new Map(documents.map((document) => [document.id, document]));

    expect(byId.get("files-row")?.collectionDocumentId).toBeNull();
  });

  it("names no parent or collection the caller can't open", async () => {
    const { documents } = await asUser(OWNER, () => listDocumentTitles.run({}));
    const byId = new Map(documents.map((document) => [document.id, document]));

    expect(byId.get("under-outsiders")?.parentId).toBeNull();
    expect(byId.get("row-in-outsiders")?.collectionDocumentId).toBeNull();
  });
});
