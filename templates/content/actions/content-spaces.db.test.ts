import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-spaces-${process.pid}-${Date.now()}.sqlite`,
);

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let provisionContentSpaces: typeof import("./_content-spaces.js").provisionContentSpaces;
let personalContentSpaceId: typeof import("./_content-spaces.js").personalContentSpaceId;
let organizationContentSpaceId: typeof import("./_content-spaces.js").organizationContentSpaceId;
let resolveContentSpaceAccess: typeof import("./_content-space-access.js").resolveContentSpaceAccess;
let listContentSpacesAction: typeof import("./list-content-spaces.js").default;
let ensureContentSpacesAction: typeof import("./ensure-content-spaces.js").default;
let deleteContentDatabaseAction: typeof import("./delete-content-database.js").default;
let deleteDocumentAction: typeof import("./delete-document.js").default;

const OWNER = "owner@example.com";
const MEMBER = "member@example.com";
const OUTSIDER = "outsider@example.com";

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
  ({ resolveContentSpaceAccess } = await import("./_content-space-access.js"));
  listContentSpacesAction = (await import("./list-content-spaces.js")).default;
  ensureContentSpacesAction = (await import("./ensure-content-spaces.js"))
    .default;
  deleteContentDatabaseAction = (await import("./delete-content-database.js"))
    .default;
  deleteDocumentAction = (await import("./delete-document.js")).default;
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
  for (const suffix of ["", "-shm", "-wal"])
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
});

async function addOrganization(id: string, name: string, owner = OWNER) {
  await getDbExec().execute({
    sql: "INSERT INTO organizations (id, name, created_by, created_at) VALUES (?, ?, ?, ?)",
    args: [id, name, owner, Date.now()],
  });
}

async function addMember(
  id: string,
  orgId: string,
  email: string,
  role = "member",
) {
  await getDbExec().execute({
    sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)",
    args: [id, orgId, email, role, Date.now()],
  });
}

describe("Content space provisioning", () => {
  it("is idempotent, opaque, and creates exactly one Files and Workspaces database", async () => {
    const first = await runWithRequestContext({ userEmail: OWNER }, () =>
      provisionContentSpaces(getDb(), OWNER),
    );
    const second = await runWithRequestContext({ userEmail: OWNER }, () =>
      provisionContentSpaces(getDb(), OWNER),
    );
    expect(first.personalSpaceId).toBe(second.personalSpaceId);
    expect(first.personalSpaceId).not.toContain(OWNER);
    expect(first.personalSpaceId).toMatch(
      /^content_space_personal_[a-f0-9]{32}$/,
    );
    expect(second.created).toEqual({
      spaces: 0,
      databases: 0,
      documents: 0,
      catalogItems: 0,
    });
    const databases = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.spaceId, first.personalSpaceId));
    expect(
      databases.filter((database: any) => database.systemRole === "files"),
    ).toHaveLength(1);
    expect(
      databases.filter((database: any) => database.systemRole === "workspaces"),
    ).toHaveLength(1);
    const files = databases.find(
      (database: any) => database.systemRole === "files",
    );
    expect(JSON.parse(files.viewConfigJson)).toMatchObject({
      activeViewId: "default",
      views: [{ id: "default", type: "sidebar", name: "Sidebar" }],
    });
    const filesSelfItems = await getDb()
      .select()
      .from(schema.contentDatabaseItems)
      .where(
        and(
          eq(schema.contentDatabaseItems.databaseId, files.id),
          eq(schema.contentDatabaseItems.documentId, files.documentId),
        ),
      );
    expect(filesSelfItems).toHaveLength(0);
    await runWithRequestContext({ userEmail: OWNER }, async () => {
      await expect(listContentSpacesAction.run({})).resolves.toMatchObject({
        spaces: expect.arrayContaining([
          expect.objectContaining({
            id: first.personalSpaceId,
            filesDatabaseId: files.id,
            filesDocumentId: files.documentId,
          }),
        ]),
      });
      await expect(
        deleteContentDatabaseAction.run({ databaseId: files.id }),
      ).rejects.toThrow("System Content databases cannot be deleted");
      await expect(
        deleteDocumentAction.run({ id: files.documentId }),
      ).rejects.toThrow("System Content database documents cannot be deleted");
    });
  });

  it("automatically reconciles legacy top-level documents into Files", async () => {
    const now = new Date().toISOString();
    await getDb().insert(schema.documents).values({
      id: "legacy-top-level-page",
      ownerEmail: OWNER,
      orgId: null,
      spaceId: null,
      parentId: null,
      title: "Legacy page",
      content: "Still here",
      position: 40,
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    });
    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      ensureContentSpacesAction.run({}),
    );
    const [document] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, "legacy-top-level-page"));
    expect(document.spaceId).toBe(result.personalSpaceId);
    await expect(
      getDb()
        .select()
        .from(schema.contentDatabaseItems)
        .where(
          and(
            eq(
              schema.contentDatabaseItems.databaseId,
              result.personalFilesDatabaseId,
            ),
            eq(schema.contentDatabaseItems.documentId, "legacy-top-level-page"),
          ),
        ),
    ).resolves.toHaveLength(1);
  });

  it("provisions every current organization membership and keeps organization Files documents org-visible", async () => {
    await addOrganization("org-alpha", "Alpha");
    await addOrganization("org-beta", "Beta");
    await addMember("owner-alpha", "org-alpha", OWNER, "owner");
    await addMember("owner-beta", "org-beta", OWNER, "admin");
    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      provisionContentSpaces(getDb(), OWNER),
    );
    expect(result.spaceIds).toEqual(
      expect.arrayContaining([
        organizationContentSpaceId("org-alpha"),
        organizationContentSpaceId("org-beta"),
      ]),
    );
    const orgSpaces = await getDb()
      .select()
      .from(schema.contentSpaces)
      .where(eq(schema.contentSpaces.orgId, "org-alpha"));
    expect(orgSpaces).toHaveLength(1);
    const [files] = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(
        and(
          eq(schema.contentDatabases.spaceId, orgSpaces[0]!.id),
          eq(schema.contentDatabases.systemRole, "files"),
        ),
      );
    const [document] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, files!.documentId));
    expect(document).toMatchObject({
      ownerEmail: OWNER,
      orgId: "org-alpha",
      visibility: "org",
    });
    const catalogItems = await getDb()
      .select()
      .from(schema.contentDatabaseItems)
      .where(
        eq(schema.contentDatabaseItems.databaseId, result.catalogDatabaseId),
      );
    expect(catalogItems.map((item: any) => item.position).sort()).toEqual([
      0, 1, 2,
    ]);
  });

  it("propagates organization renames to the space and workspace reference", async () => {
    const orgId = "org-renamed";
    const spaceId = organizationContentSpaceId(orgId);
    await addOrganization(orgId, "Before rename");
    await addMember("owner-renamed", orgId, OWNER, "owner");
    const provisioned = await runWithRequestContext({ userEmail: OWNER }, () =>
      provisionContentSpaces(getDb(), OWNER),
    );

    await getDbExec().execute({
      sql: "UPDATE organizations SET name = ? WHERE id = ?",
      args: ["After rename", orgId],
    });
    const rerun = await runWithRequestContext({ userEmail: OWNER }, () =>
      provisionContentSpaces(getDb(), OWNER),
    );
    expect(rerun.created).toEqual({
      spaces: 0,
      databases: 0,
      documents: 0,
      catalogItems: 0,
    });

    const [space] = await getDb()
      .select()
      .from(schema.contentSpaces)
      .where(eq(schema.contentSpaces.id, spaceId));
    expect(space?.name).toBe("After rename");

    const [reference] = await getDb()
      .select({ title: schema.documents.title })
      .from(schema.contentSpaceCatalogItems)
      .innerJoin(
        schema.documents,
        eq(schema.documents.id, schema.contentSpaceCatalogItems.documentId),
      )
      .where(
        and(
          eq(
            schema.contentSpaceCatalogItems.catalogDatabaseId,
            provisioned.catalogDatabaseId,
          ),
          eq(schema.contentSpaceCatalogItems.spaceId, spaceId),
        ),
      );
    expect(reference?.title).toBe("After rename");
  });

  it("lets an ordinary member provision organization Files on first login", async () => {
    const orgId = "org-viewer-provisioning";
    const spaceId = organizationContentSpaceId(orgId);
    await addOrganization(orgId, "Viewer Provisioning");
    await addMember("viewer-provisioning", orgId, MEMBER);

    const viewerResult = await runWithRequestContext(
      { userEmail: MEMBER },
      () => provisionContentSpaces(getDb(), MEMBER),
    );
    expect(viewerResult.spaceIds).toContain(spaceId);
    const [organizationSpace] = await getDb()
      .select()
      .from(schema.contentSpaces)
      .where(eq(schema.contentSpaces.id, spaceId));
    expect(organizationSpace).toMatchObject({
      id: spaceId,
      orgId,
      ownerEmail: OWNER,
      kind: "organization",
    });
    const [filesDatabase] = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(
        and(
          eq(schema.contentDatabases.spaceId, spaceId),
          eq(schema.contentDatabases.systemRole, "files"),
        ),
      );
    expect(filesDatabase).toMatchObject({
      orgId,
      ownerEmail: OWNER,
      systemRole: "files",
      blocksSeeded: 1,
    });
    await expect(
      getDb()
        .select()
        .from(schema.documentPropertyDefinitions)
        .where(
          eq(schema.documentPropertyDefinitions.databaseId, filesDatabase!.id),
        ),
    ).resolves.toHaveLength(1);
    await runWithRequestContext({ userEmail: MEMBER }, async () => {
      await expect(resolveContentSpaceAccess(spaceId)).resolves.toMatchObject({
        role: "viewer",
      });
      await expect(listContentSpacesAction.run({})).resolves.toMatchObject({
        spaces: expect.arrayContaining([
          expect.objectContaining({ id: spaceId, role: "viewer" }),
        ]),
      });
    });
  });

  it("does not let a stale catalog reference grant a non-member visibility", async () => {
    await addOrganization("org-shared", "Shared");
    await addMember("owner-shared", "org-shared", OWNER, "owner");
    await addMember("member-shared", "org-shared", MEMBER);
    await runWithRequestContext({ userEmail: OWNER }, () =>
      provisionContentSpaces(getDb(), OWNER),
    );
    await runWithRequestContext({ userEmail: MEMBER }, () =>
      provisionContentSpaces(getDb(), MEMBER),
    );
    const spaceId = organizationContentSpaceId("org-shared");
    await getDbExec().execute({
      sql: "DELETE FROM org_members WHERE id = ?",
      args: ["member-shared"],
    });
    await runWithRequestContext({ userEmail: MEMBER }, async () => {
      await expect(resolveContentSpaceAccess(spaceId)).rejects.toThrow(
        "Not authorized",
      );
      await expect(listContentSpacesAction.run({})).resolves.toMatchObject({
        spaces: expect.not.arrayContaining([
          expect.objectContaining({ id: spaceId }),
        ]),
      });
    });
  });

  it("denies an unrelated authenticated user from a personal space", async () => {
    const spaceId = personalContentSpaceId(OWNER);
    await runWithRequestContext({ userEmail: OUTSIDER }, () =>
      expect(resolveContentSpaceAccess(spaceId)).rejects.toThrow(
        "Not authorized",
      ),
    );
  });
});
