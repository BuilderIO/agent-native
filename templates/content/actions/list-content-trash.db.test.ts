import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { closeDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const fixtureDirectory = resolve(
  import.meta.dirname,
  "../../../.tmp/content-trash-query",
);
mkdirSync(fixtureDirectory, { recursive: true });
const dbPath = resolve(
  fixtureDirectory,
  `content-trash-query-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "trash-owner@example.com";
const OTHER = "trash-other@example.com";
const TIME = "2026-09-09T12:00:00.000Z";
let db: ReturnType<typeof import("../server/db/index.js").getDb>;
let schema: typeof import("../server/db/schema.js");
let action: typeof import("./list-content-trash.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${dbPath}`;
  const module = await import("../server/db/index.js");
  db = module.getDb();
  schema = module.schema;
  await (await import("../server/plugins/db.js")).default(undefined as never);
  action = (await import("./list-content-trash.js")).default;
}, 60_000);

afterAll(async () => {
  await closeDbExec();
  if (dirname(dbPath) !== fixtureDirectory)
    throw new Error("Unexpected fixture path");
  rmSync(dbPath, { force: true, recursive: true });
});

function list(
  args: Partial<Parameters<typeof action.run>[0]> = {},
  email = OWNER,
) {
  return runWithRequestContext({ userEmail: email }, () =>
    action.run({ limit: 50, ...args }),
  );
}

async function page(
  id: string,
  values: Partial<typeof schema.documents.$inferInsert> = {},
) {
  await db.insert(schema.documents).values({
    id,
    title: id,
    ownerEmail: OWNER,
    trashedAt: TIME,
    trashRootId: id,
    ...values,
  });
}

describe("unified Trash query", () => {
  it("offers the exact legacy Database restore only for an ungrouped live backing Page", async () => {
    await page("legacy-query-live", { trashedAt: null, trashRootId: null });
    await page("legacy-query-mixed", { trashedAt: TIME, trashRootId: null });
    await db.insert(schema.contentDatabases).values([
      {
        id: "legacy-query-live-db",
        documentId: "legacy-query-live",
        ownerEmail: OWNER,
        deletedAt: TIME,
      },
      {
        id: "legacy-query-mixed-db",
        documentId: "legacy-query-mixed",
        ownerEmail: OWNER,
        deletedAt: TIME,
      },
    ]);
    const result = await list({ query: "legacy-query" });
    expect(
      result.items.find((item) => item.documentId === "legacy-query-live"),
    ).toMatchObject({
      legacyRestoreDatabaseId: "legacy-query-live-db",
      canRestore: true,
      canPermanentlyDelete: false,
    });
    expect(
      result.items.find((item) => item.documentId === "legacy-query-mixed"),
    ).toMatchObject({
      legacyRestoreDatabaseId: null,
      canRestore: false,
      canPermanentlyDelete: false,
    });
  });

  it("paginates equal timestamps without duplicate backing Pages or private matches", async () => {
    await page("paging-a", { title: "paging identical" });
    await page("paging-b", { title: "paging identical" });
    await page("paging-c", { title: "paging identical" });
    await page("paging-secret", {
      title: "paging identical",
      ownerEmail: OTHER,
    });
    await db.insert(schema.contentDatabases).values([
      {
        id: "paging-db-a",
        documentId: "paging-b",
        title: "paging identical",
        deletedAt: TIME,
      },
      {
        id: "paging-db-b",
        documentId: "paging-b",
        title: "paging identical",
        deletedAt: TIME,
      },
    ]);
    const first = await list({ query: "paging", limit: 2 });
    expect(first.items.map((item) => item.documentId)).toEqual([
      "paging-c",
      "paging-b",
    ]);
    expect(first.items[1].kind).toBe("database");
    expect(first.nextCursor).toBeTruthy();
    const second = await list({
      query: "paging",
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.items.map((item) => item.documentId)).toEqual(["paging-a"]);
    expect(second.nextCursor).toBeNull();
    await expect(
      list({ query: "changed", cursor: first.nextCursor! }),
    ).rejects.toMatchObject({ errorCode: "invalid_cursor" });
    await expect(list({ cursor: "invalid" })).rejects.toMatchObject({
      errorCode: "invalid_cursor",
    });
    const corrupt = JSON.parse(
      Buffer.from(first.nextCursor!, "base64url").toString("utf8"),
    );
    corrupt.time = "not a timestamp";
    await expect(
      list({
        query: "paging",
        cursor: Buffer.from(JSON.stringify(corrupt)).toString("base64url"),
      }),
    ).rejects.toMatchObject({ errorCode: "invalid_cursor" });
  });

  it("closes title, original location, and deletion groups over present access", async () => {
    await page("location-secret", {
      ownerEmail: OTHER,
      title: "Private location",
    });
    await page("location-child", {
      parentId: "location-secret",
      trashParentId: "location-secret",
      title: "location accessible",
    });
    const result = await list({ query: "location accessible" });
    expect(result.items[0]).toMatchObject({
      parentId: null,
      parentTitle: null,
    });
    expect((await list({ parentId: "location-secret" })).items).toEqual([]);
    await page("group-root");
    await page("group-visible", {
      trashRootId: "group-root",
      parentId: "group-root",
    });
    await page("group-private", {
      trashRootId: "group-root",
      parentId: "group-root",
      ownerEmail: OTHER,
    });
    expect(
      (await list({ groupId: "group-root" })).items
        .map((item) => item.documentId)
        .sort(),
    ).toEqual(["group-root", "group-visible"]);
    await db
      .update(schema.documents)
      .set({ ownerEmail: OTHER })
      .where(eq(schema.documents.id, "group-visible"));
    expect(
      (await list({ groupId: "group-root" })).items.map(
        (item) => item.documentId,
      ),
    ).toEqual(["group-root"]);
  });

  it("preserves the block-owned host editor exception without granting ordinary Page management", async () => {
    await page("authority-host", {
      ownerEmail: OTHER,
      trashedAt: null,
      trashRootId: null,
    });
    await page("authority-db-page", {
      ownerEmail: OTHER,
      parentId: "authority-host",
    });
    await page("authority-ordinary", { ownerEmail: OTHER });
    await db.insert(schema.documentShares).values(
      ["authority-host", "authority-ordinary"].map((resourceId) => ({
        id: `share-${resourceId}`,
        resourceId,
        principalType: "user",
        principalId: OWNER,
        role: "editor",
        createdBy: OTHER,
        createdAt: TIME,
      })),
    );
    await db.insert(schema.contentDatabases).values({
      id: "authority-db",
      documentId: "authority-db-page",
      ownerDocumentId: "authority-host",
      deletedAt: TIME,
    });
    expect((await list({ query: "authority" })).items).toEqual([]);
    await db.insert(schema.documentShares).values({
      id: "share-authority-db",
      resourceId: "authority-db-page",
      principalType: "user",
      principalId: OWNER,
      role: "viewer",
      createdBy: OTHER,
      createdAt: TIME,
    });
    const result = await list({ query: "authority" });
    expect(result.items.map((item) => item.documentId)).toEqual([
      "authority-db-page",
    ]);
    expect(result.items[0].canPermanentlyDelete).toBe(false);
    await db
      .update(schema.documentShares)
      .set({ role: "viewer" })
      .where(eq(schema.documentShares.id, "share-authority-host"));
    expect((await list({ query: "authority" })).items).toEqual([]);
  });

  it("treats wildcard text literally and filters kind and known actor", async () => {
    await page("literal-one", { title: "100%_done", trashedBy: OWNER });
    await page("literal-two", { title: "100xxdone" });
    expect(
      (await list({ query: "%_", kind: "page", actor: OWNER })).items.map(
        (item) => item.documentId,
      ),
    ).toEqual(["literal-one"]);
    expect((await list({ query: "%_", kind: "database" })).items).toEqual([]);
  });

  it("redacts private spaces while preserving authorized location labels and filters", async () => {
    await db.insert(schema.contentSpaces).values([
      {
        id: "space-owned",
        name: "Owned space",
        kind: "personal",
        ownerEmail: OWNER,
        createdBy: OWNER,
        filesDatabaseId: "space-owned-files",
      },
      {
        id: "space-private",
        name: "Private space",
        kind: "personal",
        ownerEmail: OTHER,
        createdBy: OTHER,
        filesDatabaseId: "space-private-files",
      },
    ]);
    await page("space-owned-page", { spaceId: "space-owned" });
    await page("space-private-page", { spaceId: "space-private" });
    const result = await list({ query: "space-" });
    expect(
      result.items.find((item) => item.documentId === "space-private-page"),
    ).toMatchObject({ spaceId: null, spaceName: null });
    expect((await list({ spaceId: "space-owned" })).items).toMatchObject([
      { documentId: "space-owned-page", spaceName: "Owned space" },
    ]);
    expect((await list({ spaceId: "space-private" })).items).toEqual([]);
  });
});
