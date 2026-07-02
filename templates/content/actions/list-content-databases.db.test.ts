import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-list-databases-${process.pid}-${Date.now()}.sqlite`,
);

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let listContentDatabasesAction: typeof import("./list-content-databases.js").default;

const OWNER = "owner@example.com";

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  listContentDatabasesAction = (await import("./list-content-databases.js"))
    .default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

async function createDatabaseDocument(args: {
  documentId: string;
  databaseId: string;
  title: string;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  await db.insert(schema.documents).values({
    id: args.documentId,
    ownerEmail: OWNER,
    parentId: null,
    title: args.title,
    content: "",
    position: 1,
    visibility: "private",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabases).values({
    id: args.databaseId,
    ownerEmail: OWNER,
    documentId: args.documentId,
    title: args.title,
  });
}

describe("list-content-databases", () => {
  it("matches database document titles case-insensitively", async () => {
    await createDatabaseDocument({
      documentId: "db-doc-cmdk",
      databaseId: "db-cmdk",
      title: "CmdK Database TestDB",
    });

    await runWithRequestContext({ userEmail: OWNER }, async () => {
      await expect(
        listContentDatabasesAction.run({ query: "cmdk", limit: 6 }),
      ).resolves.toEqual({
        databases: [
          {
            databaseId: "db-cmdk",
            documentId: "db-doc-cmdk",
            title: "CmdK Database TestDB",
            sources: [],
          },
        ],
      });
    });
  });

  it("returns coexisting Builder, local folder, and GitHub URL source identities", async () => {
    await createDatabaseDocument({
      documentId: "db-doc-sources",
      databaseId: "db-sources",
      title: "Multi-source workspace",
    });
    const db = getDb();
    const now = new Date().toISOString();
    await db.insert(schema.contentDatabaseSources).values([
      {
        id: "source-builder",
        ownerEmail: OWNER,
        databaseId: "db-sources",
        sourceType: "builder-cms",
        sourceName: "Builder blog",
        sourceTable: "blog_article",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "source-local",
        ownerEmail: OWNER,
        databaseId: "db-sources",
        sourceType: "local-folder",
        sourceName: "Docs folder",
        sourceTable: "docs",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "source-github",
        ownerEmail: OWNER,
        databaseId: "db-sources",
        sourceType: "github-url",
        sourceName: "Docs repo URL",
        sourceTable: "https://github.com/BuilderIO/agent-native/tree/main/docs",
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await runWithRequestContext({ userEmail: OWNER }, async () => {
      await expect(
        listContentDatabasesAction.run({
          query: "multi-source",
          limit: 6,
        }),
      ).resolves.toEqual({
        databases: [
          {
            databaseId: "db-sources",
            documentId: "db-doc-sources",
            title: "Multi-source workspace",
            sources: [
              {
                id: "source-builder",
                sourceType: "builder-cms",
                sourceName: "Builder blog",
                sourceTable: "blog_article",
              },
              {
                id: "source-local",
                sourceType: "local-folder",
                sourceName: "Docs folder",
                sourceTable: "docs",
              },
              {
                id: "source-github",
                sourceType: "github-url",
                sourceName: "Docs repo URL",
                sourceTable:
                  "https://github.com/BuilderIO/agent-native/tree/main/docs",
              },
            ],
          },
        ],
      });
    });
  });
});
