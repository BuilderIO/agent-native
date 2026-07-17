import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./_local-file-documents.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("./_local-file-documents.js")>();
  return { ...original, isContentLocalFileMode: async () => false };
});

const TEST_DB_PATH = join(
  tmpdir(),
  `space-aware-writers-${process.pid}-${Date.now()}.sqlite`,
);

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let createDocument: typeof import("./create-document.js").default;
let createContentDatabase: typeof import("./create-content-database.js").default;
let addDatabaseItem: typeof import("./add-database-item.js").default;
let organizationContentSpaceId: typeof import("./_content-spaces.js").organizationContentSpaceId;

const OWNER = "owner@example.com";
const MEMBER = "member@example.com";
const VIEWER = "viewer@example.com";
const OUTSIDER = "outsider@example.com";

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  createDocument = (await import("./create-document.js")).default;
  createContentDatabase = (await import("./create-content-database.js"))
    .default;
  addDatabaseItem = (await import("./add-database-item.js")).default;
  ({ organizationContentSpaceId } = await import("./_content-spaces.js"));
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at INTEGER NOT NULL
  )`);
}, 60000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

async function addOrganizationMember(args: {
  orgId: string;
  email: string;
  role?: string;
}) {
  await getDbExec().execute({
    sql: "INSERT OR IGNORE INTO organizations (id, name, created_by, created_at) VALUES (?, ?, ?, ?)",
    args: [args.orgId, "Shared workspace", OWNER, Date.now()],
  });
  await getDbExec().execute({
    sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)",
    args: [
      `${args.orgId}:${args.email}`,
      args.orgId,
      args.email,
      args.role ?? "member",
      Date.now(),
    ],
  });
}

async function filesMemberships(documentId: string) {
  return getDb()
    .select({
      itemId: schema.contentDatabaseItems.id,
      databaseId: schema.contentDatabaseItems.databaseId,
      spaceId: schema.contentDatabases.spaceId,
    })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.contentDatabases,
      eq(schema.contentDatabases.id, schema.contentDatabaseItems.databaseId),
    )
    .where(
      and(
        eq(schema.contentDatabaseItems.documentId, documentId),
        eq(schema.contentDatabases.systemRole, "files"),
      ),
    );
}

describe("space-aware document writers", () => {
  it("defaults root pages to personal Files and keeps nested pages in the parent space", async () => {
    const parent = await runWithRequestContext({ userEmail: OWNER }, () =>
      createDocument.run({ title: "Parent" }),
    );
    const child = await runWithRequestContext({ userEmail: OWNER }, () =>
      createDocument.run({ title: "Child", parentId: parent.id }),
    );

    const rows = await getDb()
      .select({ id: schema.documents.id, spaceId: schema.documents.spaceId })
      .from(schema.documents)
      .where(eq(schema.documents.id, child.id));
    expect(rows[0]?.spaceId).toBeTruthy();
    await expect(filesMemberships(parent.id)).resolves.toHaveLength(1);
    await expect(filesMemberships(child.id)).resolves.toEqual([
      expect.objectContaining({ spaceId: rows[0]?.spaceId }),
    ]);

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        createDocument.run({
          title: "Wrong space",
          parentId: parent.id,
          spaceId: "content_space_elsewhere",
        }),
      ),
    ).rejects.toThrow("parent Content space");
  });

  it("requires organization editor access for root page and database creation", async () => {
    const orgId = "org-shared-writers";
    await addOrganizationMember({ orgId, email: MEMBER, role: "admin" });
    await addOrganizationMember({ orgId, email: VIEWER });
    const spaceId = organizationContentSpaceId(orgId);
    const created = await runWithRequestContext(
      { userEmail: MEMBER, orgId },
      () => createDocument.run({ title: "Member page", spaceId }),
    );

    const [document] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, created.id));
    expect(document).toMatchObject({
      spaceId,
      ownerEmail: MEMBER,
      orgId,
      visibility: "org",
    });
    await expect(filesMemberships(created.id)).resolves.toHaveLength(1);

    const createdDatabase = await runWithRequestContext(
      { userEmail: MEMBER, orgId },
      () =>
        createContentDatabase.run({
          title: "Member database",
          spaceId,
        }),
    );
    const [database] = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, createdDatabase.database.id));
    expect(database).toMatchObject({ spaceId, ownerEmail: MEMBER, orgId });
    await expect(
      filesMemberships(createdDatabase.database.documentId),
    ).resolves.toHaveLength(1);

    await expect(
      runWithRequestContext({ userEmail: VIEWER, orgId }, () =>
        createDocument.run({ title: "Viewer page", spaceId }),
      ),
    ).rejects.toThrow("Editor access is required");
    await expect(
      runWithRequestContext({ userEmail: VIEWER, orgId }, () =>
        createContentDatabase.run({ title: "Viewer database", spaceId }),
      ),
    ).rejects.toThrow("Editor access is required");
    await expect(
      runWithRequestContext({ userEmail: OUTSIDER }, () =>
        createDocument.run({ title: "No entry", spaceId }),
      ),
    ).rejects.toThrow("Not authorized");
  });

  it("creates canonical Files memberships when the target organization differs from the active organization", async () => {
    const activeOrgId = "org-active-writers";
    const targetOrgId = "org-target-writers";
    await addOrganizationMember({
      orgId: activeOrgId,
      email: MEMBER,
      role: "admin",
    });
    await addOrganizationMember({
      orgId: targetOrgId,
      email: MEMBER,
      role: "admin",
    });
    const targetSpaceId = organizationContentSpaceId(targetOrgId);

    const page = await runWithRequestContext(
      { userEmail: MEMBER, orgId: activeOrgId },
      () =>
        createDocument.run({
          title: "Cross-organization page",
          spaceId: targetSpaceId,
        }),
    );
    await expect(filesMemberships(page.id)).resolves.toEqual([
      expect.objectContaining({ spaceId: targetSpaceId }),
    ]);

    const createdDatabase = await runWithRequestContext(
      { userEmail: MEMBER, orgId: activeOrgId },
      () =>
        createContentDatabase.run({
          title: "Cross-organization database",
          spaceId: targetSpaceId,
        }),
    );
    await expect(
      filesMemberships(createdDatabase.database.documentId),
    ).resolves.toEqual([expect.objectContaining({ spaceId: targetSpaceId })]);
  });

  it("keeps databases and their rows in one space and repairs converted page membership", async () => {
    const page = await runWithRequestContext({ userEmail: OWNER }, () =>
      createDocument.run({ title: "Convert me" }),
    );
    const [pageRow] = await getDb()
      .select({ spaceId: schema.documents.spaceId })
      .from(schema.documents)
      .where(eq(schema.documents.id, page.id));
    await getDb()
      .delete(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.documentId, page.id));

    const converted = await runWithRequestContext({ userEmail: OWNER }, () =>
      createContentDatabase.run({ documentId: page.id }),
    );
    const [databaseRow] = await getDb()
      .select({ spaceId: schema.contentDatabases.spaceId })
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, converted.database.id));
    expect(databaseRow?.spaceId).toBe(pageRow?.spaceId);
    await expect(filesMemberships(page.id)).resolves.toHaveLength(1);

    const row = await runWithRequestContext({ userEmail: OWNER }, () =>
      addDatabaseItem.run({
        databaseId: converted.database.id,
        title: "Database row",
      }),
    );
    const [rowDocument] = await getDb()
      .select({ spaceId: schema.documents.spaceId })
      .from(schema.documents)
      .where(eq(schema.documents.id, row.createdDocumentId!));
    expect(rowDocument?.spaceId).toBe(pageRow?.spaceId);
    await expect(
      filesMemberships(row.createdDocumentId!),
    ).resolves.toHaveLength(1);
  });

  it("rejects database row creation when a legacy database has no Content space", async () => {
    const now = new Date().toISOString();
    await getDb().insert(schema.documents).values({
      id: "legacy-unscoped-database-document",
      ownerEmail: OWNER,
      orgId: null,
      spaceId: null,
      parentId: null,
      title: "Legacy unscoped database",
      content: "",
      position: 0,
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(schema.contentDatabases).values({
      id: "legacy-unscoped-database",
      ownerEmail: OWNER,
      orgId: null,
      spaceId: null,
      documentId: "legacy-unscoped-database-document",
      title: "Legacy unscoped database",
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        addDatabaseItem.run({
          databaseId: "legacy-unscoped-database",
          title: "Must not be created",
        }),
      ),
    ).rejects.toThrow("does not belong to a Content space");
    await expect(
      getDb()
        .select()
        .from(schema.documents)
        .where(
          eq(schema.documents.parentId, "legacy-unscoped-database-document"),
        ),
    ).resolves.toHaveLength(0);
  });
});
