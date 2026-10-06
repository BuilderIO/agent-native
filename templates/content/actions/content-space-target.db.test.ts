import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-space-target-${process.pid}-${Date.now()}.pglite`,
);

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let personalContentSpaceId: typeof import("./_content-spaces.js").personalContentSpaceId;
let ensureContentSpacesAction: typeof import("./ensure-content-spaces.js").default;
let createContentSpaceAction: typeof import("./create-content-space.js").default;
let createDocumentAction: typeof import("./create-document.js").default;
let addDatabaseItemAction: typeof import("./add-database-item.js").default;
let getContentDatabaseAction: typeof import("./get-content-database.js").default;

const USER = "space-target@example.com";

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  ({ personalContentSpaceId } = await import("./_content-spaces.js"));
  ensureContentSpacesAction = (await import("./ensure-content-spaces.js"))
    .default;
  createContentSpaceAction = (await import("./create-content-space.js"))
    .default;
  createDocumentAction = (await import("./create-document.js")).default;
  addDatabaseItemAction = (await import("./add-database-item.js")).default;
  getContentDatabaseAction = (await import("./get-content-database.js"))
    .default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
    identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at INTEGER NOT NULL,
    federation_removal_pending_at INTEGER
  )`);
}, 60000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

async function foobarSpaceId() {
  await runWithRequestContext({ userEmail: USER }, () =>
    ensureContentSpacesAction.run({}),
  );
  const created = await runWithRequestContext({ userEmail: USER }, () =>
    createContentSpaceAction.run({
      name: "Foobar",
      requestId: "space-target-foobar",
    }),
  );
  return created.spaceId as string;
}

describe("named workspace create targets", () => {
  it("creates pages in the named workspace, not the personal default", async () => {
    const spaceId = await foobarSpaceId();
    const personalSpaceId = personalContentSpaceId(USER);
    expect(spaceId).not.toBe(personalSpaceId);

    const created = await Promise.all(
      ["Placeholder 1", "Placeholder 2", "Placeholder 3"].map((title) =>
        runWithRequestContext({ userEmail: USER }, () =>
          createDocumentAction.run({
            title,
            spaceName: "Foobar",
            reuseLabels: [],
          } as any),
        ),
      ),
    );

    for (const document of created) {
      expect(document.spaceId).toBe(spaceId);
    }

    const rows = await getDb()
      .select({ id: schema.documents.id, spaceId: schema.documents.spaceId })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.ownerEmail, USER),
          eq(schema.documents.spaceId, spaceId),
        ),
      );
    const createdIds = new Set(created.map((document) => document.id));
    expect(rows.filter((row: any) => createdIds.has(row.id))).toHaveLength(3);

    const personalRows = await getDb()
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.ownerEmail, USER),
          eq(schema.documents.spaceId, personalSpaceId),
        ),
      );
    expect(
      personalRows.filter((row: any) => createdIds.has(row.id)),
    ).toHaveLength(0);

    const [files] = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(
        and(
          eq(schema.contentDatabases.systemRole, "files"),
          eq(schema.contentDatabases.spaceId, spaceId),
        ),
      );
    const filesTable = await runWithRequestContext({ userEmail: USER }, () =>
      getContentDatabaseAction.run({ databaseId: files.id } as any),
    );
    const titles = filesTable.items.map(
      (item: any) => item.document.title as string,
    );
    expect(titles).toEqual(
      expect.arrayContaining([
        "Placeholder 1",
        "Placeholder 2",
        "Placeholder 3",
      ]),
    );
  });

  it("rejects an unknown workspace name instead of falling back to Personal", async () => {
    await foobarSpaceId();
    await expect(
      runWithRequestContext({ userEmail: USER }, () =>
        createDocumentAction.run({
          title: "Should not exist",
          spaceName: "Nope",
          reuseLabels: [],
        } as any),
      ),
    ).rejects.toThrow(/No Content workspace named "Nope"/);

    const personalRows = await getDb()
      .select({ id: schema.documents.id, title: schema.documents.title })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.ownerEmail, USER),
          eq(schema.documents.spaceId, personalContentSpaceId(USER)),
        ),
      );
    expect(
      personalRows.some((row: any) => row.title === "Should not exist"),
    ).toBe(false);
  });

  it("tells the caller where to create pages when it targets the Workspaces catalog", async () => {
    await foobarSpaceId();
    const catalog = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.systemRole, "workspaces"));
    expect(catalog.length).toBeGreaterThan(0);
    const target = catalog[0];

    await expect(
      runWithRequestContext({ userEmail: USER }, () =>
        addDatabaseItemAction.run({
          target: {
            spaceId: target.spaceId,
            databaseId: target.id,
            databaseDocumentId: target.documentId,
          },
          expectedSchemaRevision: "sha256:anything",
          idempotencyKey: "workspaces-catalog-create",
          title: "Placeholder",
        } as any),
      ),
    ).rejects.toThrow(/create-document with that workspace's spaceId/);
  });
});
