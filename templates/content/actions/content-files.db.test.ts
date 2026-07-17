import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-files-${process.pid}-${Date.now()}.sqlite`,
);
const OWNER = "files-owner@example.com";
const ORG_ID = "files-org";
const VIEWER = "files-viewer@example.com";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let provisionContentSpaces: typeof import("./_content-spaces.js").provisionContentSpaces;
let personalContentSpaceId: typeof import("./_content-spaces.js").personalContentSpaceId;
let organizationContentSpaceId: typeof import("./_content-spaces.js").organizationContentSpaceId;
let reconcileContentFilesMemberships: typeof import("./_content-files.js").reconcileContentFilesMemberships;
let getContentDatabaseAction: typeof import("./get-content-database.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  ({
    provisionContentSpaces,
    personalContentSpaceId,
    organizationContentSpaceId,
  } = await import("./_content-spaces.js"));
  ({ reconcileContentFilesMemberships } = await import("./_content-files.js"));
  getContentDatabaseAction = (await import("./get-content-database.js"))
    .default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at INTEGER NOT NULL
  )`);
  await getDbExec().execute({
    sql: "INSERT INTO organizations (id, name, created_by, created_at) VALUES (?, ?, ?, ?)",
    args: [ORG_ID, "Files Org", OWNER, Date.now()],
  });
  await getDbExec().execute({
    sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)",
    args: ["files-owner-membership", ORG_ID, OWNER, "owner", Date.now()],
  });
  await runWithRequestContext({ userEmail: OWNER }, () =>
    provisionContentSpaces(getDb(), OWNER),
  );
}, 60000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"])
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
});

async function createLegacyDocument(args: {
  id: string;
  orgId: string | null;
  title: string;
}) {
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.documents)
    .values({
      id: args.id,
      ownerEmail: OWNER,
      orgId: args.orgId,
      spaceId: null,
      title: args.title,
      content: "",
      description: "",
      position: 0,
      isFavorite: 0,
      hideFromSearch: 0,
      visibility: args.orgId ? "org" : "private",
      createdAt: now,
      updatedAt: now,
    });
}

async function getFilesDatabase(spaceId: string) {
  const [database] = await getDb()
    .select()
    .from(schema.contentDatabases)
    .where(
      and(
        eq(schema.contentDatabases.spaceId, spaceId),
        eq(schema.contentDatabases.systemRole, "files"),
      ),
    );
  if (!database) throw new Error(`Missing Files database for ${spaceId}`);
  return database;
}

describe("Content Files membership reconciliation", () => {
  it("lets an ordinary member backfill legacy organization pages without changing their content or ownership", async () => {
    const viewerOrgId = "files-viewer-org";
    await getDbExec().execute({
      sql: "INSERT INTO organizations (id, name, created_by, created_at) VALUES (?, ?, ?, ?)",
      args: [viewerOrgId, "Viewer Org", OWNER, Date.now()],
    });
    await getDbExec().execute({
      sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)",
      args: ["viewer-org-owner", viewerOrgId, OWNER, "owner", Date.now()],
    });
    await getDbExec().execute({
      sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)",
      args: ["viewer-org-viewer", viewerOrgId, VIEWER, "member", Date.now()],
    });
    await runWithRequestContext({ userEmail: OWNER }, () =>
      provisionContentSpaces(getDb(), OWNER),
    );
    await createLegacyDocument({
      id: "viewer-legacy-org",
      orgId: viewerOrgId,
      title: "Member can reconcile",
    });
    await createLegacyDocument({
      id: "owner-private-org",
      orgId: viewerOrgId,
      title: "Owner private page",
    });
    await getDb()
      .update(schema.documents)
      .set({ content: "Keep this body exactly", icon: "📚" })
      .where(eq(schema.documents.id, "viewer-legacy-org"));
    await getDb()
      .update(schema.documents)
      .set({ visibility: "private" })
      .where(eq(schema.documents.id, "owner-private-org"));
    const [before] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, "viewer-legacy-org"));

    await runWithRequestContext({ userEmail: VIEWER }, () =>
      reconcileContentFilesMemberships(getDb(), VIEWER),
    );

    const [legacyDocument] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, "viewer-legacy-org"));
    expect(legacyDocument).toMatchObject({
      id: before!.id,
      ownerEmail: before!.ownerEmail,
      orgId: before!.orgId,
      title: before!.title,
      content: before!.content,
      icon: before!.icon,
      visibility: before!.visibility,
      spaceId: organizationContentSpaceId(viewerOrgId),
    });
    const filesDatabase = await getFilesDatabase(
      organizationContentSpaceId(viewerOrgId),
    );
    await expect(
      getDb()
        .select()
        .from(schema.contentDatabaseItems)
        .where(
          and(
            eq(schema.contentDatabaseItems.databaseId, filesDatabase.id),
            eq(schema.contentDatabaseItems.documentId, "viewer-legacy-org"),
          ),
        ),
    ).resolves.toHaveLength(1);
    const databaseResponse = await runWithRequestContext(
      { userEmail: VIEWER, orgId: viewerOrgId },
      () => getContentDatabaseAction.run({ databaseId: filesDatabase.id }),
    );
    expect(databaseResponse).toMatchObject({
      database: { id: filesDatabase.id, systemRole: "files" },
      items: expect.arrayContaining([
        expect.objectContaining({
          document: expect.objectContaining({
            id: "viewer-legacy-org",
            title: "Member can reconcile",
          }),
        }),
      ]),
    });
    expect(databaseResponse.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          document: expect.objectContaining({ id: "owner-private-org" }),
        }),
      ]),
    );
    await getDb()
      .delete(schema.documents)
      .where(
        inArray(schema.documents.id, [
          "viewer-legacy-org",
          "owner-private-org",
        ]),
      );
  });

  it("assigns personal and organization legacy pages to their canonical Files databases", async () => {
    await createLegacyDocument({
      id: "legacy-personal",
      orgId: null,
      title: "Personal",
    });
    await createLegacyDocument({
      id: "legacy-org",
      orgId: ORG_ID,
      title: "Organization",
    });
    const personalSpaceId = personalContentSpaceId(OWNER);
    const orgSpaceId = organizationContentSpaceId(ORG_ID);
    const personalFiles = await getFilesDatabase(personalSpaceId);
    const orgFiles = await getFilesDatabase(orgSpaceId);
    const now = new Date().toISOString();
    await getDb().insert(schema.contentDatabaseItems).values({
      id: "wrong-files-membership",
      ownerEmail: OWNER,
      orgId: null,
      databaseId: orgFiles.id,
      documentId: "legacy-personal",
      position: 99,
      createdAt: now,
      updatedAt: now,
    });

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      reconcileContentFilesMemberships(getDb(), OWNER),
    );
    expect(result.assignedSpaces).toBe(2);
    const documents = await getDb().select().from(schema.documents);
    expect(
      documents.find((document: any) => document.id === "legacy-personal")
        ?.spaceId,
    ).toBe(personalSpaceId);
    expect(
      documents.find((document: any) => document.id === "legacy-org")?.spaceId,
    ).toBe(orgSpaceId);
    const personalItems = await getDb()
      .select()
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.documentId, "legacy-personal"));
    const orgItems = await getDb()
      .select()
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.documentId, "legacy-org"));
    expect(
      personalItems.filter((item: any) => item.databaseId === personalFiles.id),
    ).toHaveLength(1);
    expect(
      personalItems.filter((item: any) => item.databaseId === orgFiles.id),
    ).toHaveLength(0);
    expect(
      orgItems.filter((item: any) => item.databaseId === orgFiles.id),
    ).toHaveLength(1);
  });

  it("is idempotent and never adds a Files database backing document to a Files database", async () => {
    const personalFiles = await getFilesDatabase(personalContentSpaceId(OWNER));
    const second = await runWithRequestContext({ userEmail: OWNER }, () =>
      reconcileContentFilesMemberships(getDb(), OWNER),
    );
    expect(second).toMatchObject({
      assignedSpaces: 0,
      insertedMemberships: 0,
      removedMemberships: 0,
    });
    const selfItems = await getDb()
      .select()
      .from(schema.contentDatabaseItems)
      .where(
        and(
          eq(schema.contentDatabaseItems.databaseId, personalFiles.id),
          eq(schema.contentDatabaseItems.documentId, personalFiles.documentId),
        ),
      );
    expect(selfItems).toHaveLength(0);
  });

  it("repairs duplicate canonical memberships before uniqueness is enforced", async () => {
    const personalFiles = await getFilesDatabase(personalContentSpaceId(OWNER));
    const [canonicalMembership] = await getDb()
      .select()
      .from(schema.contentDatabaseItems)
      .where(
        and(
          eq(schema.contentDatabaseItems.databaseId, personalFiles.id),
          eq(schema.contentDatabaseItems.documentId, "legacy-personal"),
        ),
      );
    if (!canonicalMembership) throw new Error("Missing canonical membership");
    await getDbExec().execute(
      "DROP INDEX content_database_items_database_document_unique",
    );
    try {
      const now = new Date().toISOString();
      await getDb().insert(schema.contentDatabaseItems).values({
        id: "duplicate-files-membership",
        ownerEmail: OWNER,
        orgId: null,
        databaseId: personalFiles.id,
        documentId: "legacy-personal",
        position: 100,
        createdAt: now,
        updatedAt: now,
      });
      await getDb().insert(schema.contentDatabaseSourceRows).values({
        id: "duplicate-membership-source-row",
        ownerEmail: OWNER,
        sourceId: "duplicate-membership-source",
        databaseItemId: "duplicate-files-membership",
        documentId: "legacy-personal",
        sourceRowId: "source-row",
        sourceQualifiedId: "source:row",
        sourceDisplayKey: "row",
        sourceValuesJson: "{}",
        createdAt: now,
        updatedAt: now,
      });
      await getDb().insert(schema.contentSpaceCatalogItems).values({
        id: "duplicate-membership-catalog-reference",
        ownerEmail: OWNER,
        catalogDatabaseId: "test-catalog",
        databaseItemId: "duplicate-files-membership",
        documentId: "legacy-personal",
        spaceId: "test-space",
        createdAt: now,
        updatedAt: now,
      });
      const result = await runWithRequestContext({ userEmail: OWNER }, () =>
        reconcileContentFilesMemberships(getDb(), OWNER),
      );
      expect(result.removedMemberships).toBe(1);
      const memberships = await getDb()
        .select()
        .from(schema.contentDatabaseItems)
        .where(
          and(
            eq(schema.contentDatabaseItems.databaseId, personalFiles.id),
            eq(schema.contentDatabaseItems.documentId, "legacy-personal"),
          ),
        );
      expect(memberships).toHaveLength(1);
      const [sourceRow] = await getDb()
        .select()
        .from(schema.contentDatabaseSourceRows)
        .where(
          eq(
            schema.contentDatabaseSourceRows.id,
            "duplicate-membership-source-row",
          ),
        );
      const [catalogReference] = await getDb()
        .select()
        .from(schema.contentSpaceCatalogItems)
        .where(
          eq(
            schema.contentSpaceCatalogItems.id,
            "duplicate-membership-catalog-reference",
          ),
        );
      expect(sourceRow?.databaseItemId).toBe(canonicalMembership.id);
      expect(catalogReference?.databaseItemId).toBe(canonicalMembership.id);
    } finally {
      await getDbExec().execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS content_database_items_database_document_unique ON content_database_items (database_id, document_id)",
      );
    }
  });
});
