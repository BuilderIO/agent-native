import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-attach-source-${process.pid}-${Date.now()}.sqlite`,
);

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let attachSourceAction: typeof import("./attach-content-database-source.js").default;
let changeSourceRoleAction: typeof import("./change-content-database-source-role.js").default;

const OWNER = "owner@example.com";

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  attachSourceAction = (await import("./attach-content-database-source.js"))
    .default;
  changeSourceRoleAction = (
    await import("./change-content-database-source-role.js")
  ).default;
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

describe("attach-content-database-source", () => {
  it("registers mounted local folders without claiming row or title truth", async () => {
    await createDatabaseDocument({
      documentId: "mounted-local-doc",
      databaseId: "mounted-local-db",
      title: "Mounted local workspace",
    });

    await runWithRequestContext({ userEmail: OWNER }, async () => {
      await attachSourceAction.run({
        databaseId: "mounted-local-db",
        sourceType: "local-folder",
        sourceName: "Docs folder",
        sourceTable: "docs",
        relationshipMode: "items",
      });
    });

    const db = getDb();
    const [source] = await db.select().from(schema.contentDatabaseSources);
    expect(source).toMatchObject({
      databaseId: "mounted-local-db",
      sourceType: "local-folder",
      sourceName: "Docs folder",
      sourceTable: "docs",
    });
    expect(JSON.parse(source.capabilitiesJson)).toMatchObject({
      canRefresh: false,
      canCreateChangeSets: false,
      canPush: false,
      readOnlyRefresh: false,
    });

    const fields = await db.select().from(schema.contentDatabaseSourceFields);
    const fieldKeys = fields.map((field: any) => field.localFieldKey);
    expect(fieldKeys).toContain("source_path");
    expect(fieldKeys).not.toContain("title");
    const rows = await db.select().from(schema.contentDatabaseSourceRows);
    expect(rows).toEqual([]);
  });

  it("rejects invalid GitHub URLs before registering a source", async () => {
    await createDatabaseDocument({
      documentId: "mounted-github-doc",
      databaseId: "mounted-github-db",
      title: "Mounted GitHub workspace",
    });

    await runWithRequestContext({ userEmail: OWNER }, async () => {
      await expect(
        attachSourceAction.run({
          databaseId: "mounted-github-db",
          sourceType: "github-url",
          sourceTable: "https://gitlab.com/example/repo",
        }),
      ).rejects.toThrow("GitHub URL sources must be https://github.com/");
    });
  });

  it("rejects role changes for mounted source identity records", async () => {
    await createDatabaseDocument({
      documentId: "mounted-role-doc",
      databaseId: "mounted-role-db",
      title: "Mounted role workspace",
    });

    await runWithRequestContext({ userEmail: OWNER }, async () => {
      await attachSourceAction.run({
        databaseId: "mounted-role-db",
        sourceType: "github-url",
        sourceName: "Docs repo",
        sourceTable: "https://github.com/BuilderIO/agent-native",
      });
    });

    const db = getDb();
    const source = (await db.select().from(schema.contentDatabaseSources)).find(
      (item: any) => item.databaseId === "mounted-role-db",
    );

    await runWithRequestContext({ userEmail: OWNER }, async () => {
      await expect(
        changeSourceRoleAction.run({
          databaseId: "mounted-role-db",
          sourceId: source.id,
          relationshipMode: "details",
          join: {
            canonicalKey: { label: "URL", type: "text" },
            primary: {
              keyField: "url",
              normalizationFormula: "lower(trim({url}))",
            },
            secondary: {
              keyField: "url",
              normalizationFormula: "lower(trim({url}))",
            },
          },
        }),
      ).rejects.toThrow(
        "Local folder and GitHub URL sources only register workspace scope",
      );
    });
  });
});
