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
let createContentSpaceAction: typeof import("./create-content-space.js").default;
let deleteContentSpaceAction: typeof import("./delete-content-space.js").default;
let createDocumentAction: typeof import("./create-document.js").default;
let listDocumentsAction: typeof import("./list-documents.js").default;
let getDocumentAction: typeof import("./get-document.js").default;
let getContentDatabaseAction: typeof import("./get-content-database.js").default;
let updateDocumentAction: typeof import("./update-document.js").default;
let setDocumentPropertyAction: typeof import("./set-document-property.js").default;
let deleteContentDatabaseAction: typeof import("./delete-content-database.js").default;
let deleteDocumentAction: typeof import("./delete-document.js").default;
let deleteDatabaseItemsAction: typeof import("./delete-database-items.js").default;
let addDatabaseItemAction: typeof import("./add-database-item.js").default;
let duplicateDatabaseItemAction: typeof import("./duplicate-database-item.js").default;
let duplicateDatabaseItemsAction: typeof import("./duplicate-database-items.js").default;

const OWNER = "owner@example.com";
const MEMBER = "member@example.com";
const OUTSIDER = "outsider@example.com";
const WORKSPACE_OWNER = "workspace-owner@example.com";

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
  createContentSpaceAction = (await import("./create-content-space.js"))
    .default;
  deleteContentSpaceAction = (await import("./delete-content-space.js"))
    .default;
  createDocumentAction = (await import("./create-document.js")).default;
  listDocumentsAction = (await import("./list-documents.js")).default;
  getDocumentAction = (await import("./get-document.js")).default;
  getContentDatabaseAction = (await import("./get-content-database.js"))
    .default;
  updateDocumentAction = (await import("./update-document.js")).default;
  setDocumentPropertyAction = (await import("./set-document-property.js"))
    .default;
  deleteContentDatabaseAction = (await import("./delete-content-database.js"))
    .default;
  deleteDocumentAction = (await import("./delete-document.js")).default;
  deleteDatabaseItemsAction = (await import("./delete-database-items.js"))
    .default;
  addDatabaseItemAction = (await import("./add-database-item.js")).default;
  duplicateDatabaseItemAction = (await import("./duplicate-database-item.js"))
    .default;
  duplicateDatabaseItemsAction = (await import("./duplicate-database-items.js"))
    .default;
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
  it("creates an idempotent private named workspace with canonical Files", async () => {
    const provisioned = await runWithRequestContext(
      { userEmail: WORKSPACE_OWNER },
      () => provisionContentSpaces(getDb(), WORKSPACE_OWNER),
    );
    const now = new Date().toISOString();
    await getDb().insert(schema.documentPropertyDefinitions).values({
      id: "workspace-focus-property",
      ownerEmail: WORKSPACE_OWNER,
      orgId: null,
      databaseId: provisioned.catalogDatabaseId,
      name: "Focus",
      type: "text",
      position: 0,
      createdAt: now,
      updatedAt: now,
    });
    const create = () =>
      runWithRequestContext({ userEmail: WORKSPACE_OWNER }, () =>
        createContentSpaceAction.run({
          name: "Writing",
          requestId: "named-workspace-writing",
          propertyValues: { "workspace-focus-property": "Editorial" },
        }),
      );
    const first = await create();
    const second = await create();
    expect(second).toEqual(first);
    await expect(
      runWithRequestContext({ userEmail: WORKSPACE_OWNER }, () =>
        createContentSpaceAction.run({
          name: "Different name",
          requestId: "named-workspace-writing",
        }),
      ),
    ).rejects.toThrow("Workspace request ID is already bound to another name");
    expect(first.spaceId).toMatch(/^content_space_user_[a-f0-9]{32}$/);
    expect(first.spaceId).not.toContain(WORKSPACE_OWNER);
    const [focusValue] = await getDb()
      .select()
      .from(schema.documentPropertyValues)
      .where(
        and(
          eq(schema.documentPropertyValues.documentId, first.catalogDocumentId),
          eq(
            schema.documentPropertyValues.propertyId,
            "workspace-focus-property",
          ),
        ),
      );
    expect(JSON.parse(focusValue.valueJson)).toBe("Editorial");
    await runWithRequestContext({ userEmail: WORKSPACE_OWNER }, () =>
      createContentSpaceAction.run({
        name: "Writing",
        requestId: "named-workspace-writing",
        propertyValues: { "workspace-focus-property": "Changed on retry" },
      }),
    );
    const [focusValueAfterRetry] = await getDb()
      .select()
      .from(schema.documentPropertyValues)
      .where(eq(schema.documentPropertyValues.id, focusValue.id));
    expect(JSON.parse(focusValueAfterRetry.valueJson)).toBe("Editorial");
    await getDb()
      .update(schema.documents)
      .set({ title: "Writing alias" })
      .where(eq(schema.documents.id, first.catalogDocumentId));
    await create();
    const [aliasedReference] = await getDb()
      .select({ title: schema.documents.title })
      .from(schema.documents)
      .where(eq(schema.documents.id, first.catalogDocumentId));
    expect(aliasedReference.title).toBe("Writing alias");

    const [space] = await getDb()
      .select()
      .from(schema.contentSpaces)
      .where(eq(schema.contentSpaces.id, first.spaceId));
    expect(space).toMatchObject({
      name: "Writing",
      kind: "user",
      ownerEmail: WORKSPACE_OWNER,
      orgId: null,
      filesDatabaseId: first.filesDatabaseId,
    });
    const [files] = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, first.filesDatabaseId));
    expect(files).toMatchObject({
      documentId: first.filesDocumentId,
      ownerEmail: WORKSPACE_OWNER,
      orgId: null,
      systemRole: "files",
      blocksSeeded: 1,
    });
    const [filesDocument] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, first.filesDocumentId));
    expect(filesDocument).toMatchObject({
      spaceId: first.spaceId,
      visibility: "private",
      ownerEmail: WORKSPACE_OWNER,
    });

    const ownerSpaces = await runWithRequestContext(
      { userEmail: WORKSPACE_OWNER },
      () => listContentSpacesAction.run({}),
    );
    expect(ownerSpaces.spaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.spaceId, name: "Writing" }),
      ]),
    );
    const outsiderSpaces = await runWithRequestContext(
      { userEmail: OUTSIDER },
      () => listContentSpacesAction.run({}),
    );
    expect(outsiderSpaces.spaces).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: first.spaceId })]),
    );
    const workspacePage = await runWithRequestContext(
      { userEmail: WORKSPACE_OWNER },
      () =>
        createDocumentAction.run({
          title: "Workspace draft",
          spaceId: first.spaceId,
        }),
    );
    await runWithRequestContext({ userEmail: WORKSPACE_OWNER }, async () => {
      await expect(
        deleteDocumentAction.run({ id: first.catalogDocumentId }),
      ).rejects.toThrow("Workspace references cannot be deleted as pages");
      await expect(
        deleteDatabaseItemsAction.run({
          databaseId: first.catalogDatabaseId,
          itemIds: [first.catalogItemId],
        }),
      ).rejects.toThrow("Workspace references cannot be deleted as pages");
      await expect(
        duplicateDatabaseItemAction.run({ itemId: first.catalogItemId }),
      ).rejects.toThrow("Workspace references cannot be duplicated as pages");
      await expect(
        duplicateDatabaseItemsAction.run({
          databaseId: first.catalogDatabaseId,
          itemIds: [first.catalogItemId],
        }),
      ).rejects.toThrow("Workspace references cannot be duplicated as pages");
      await deleteContentSpaceAction.run({ spaceId: first.spaceId });
    });
    const deletedWorkspaceRows = await Promise.all([
      getDb()
        .select()
        .from(schema.contentSpaces)
        .where(eq(schema.contentSpaces.id, first.spaceId)),
      getDb()
        .select()
        .from(schema.contentSpaceCatalogItems)
        .where(eq(schema.contentSpaceCatalogItems.spaceId, first.spaceId)),
      getDb()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, workspacePage.id)),
      getDb()
        .select()
        .from(schema.contentDatabases)
        .where(eq(schema.contentDatabases.id, first.filesDatabaseId)),
    ]);
    expect(deletedWorkspaceRows.every((rows) => rows.length === 0)).toBe(true);
  });

  it("only lets owners delete user-created workspaces", async () => {
    const provisioned = await runWithRequestContext(
      { userEmail: WORKSPACE_OWNER },
      () => provisionContentSpaces(getDb(), WORKSPACE_OWNER),
    );
    await expect(
      runWithRequestContext({ userEmail: WORKSPACE_OWNER }, () =>
        deleteContentSpaceAction.run({
          spaceId: provisioned.personalSpaceId,
        }),
      ),
    ).rejects.toThrow("Only user-created workspaces can be deleted");

    const workspace = await runWithRequestContext(
      { userEmail: WORKSPACE_OWNER },
      () =>
        createContentSpaceAction.run({
          name: "Private planning",
          requestId: "delete-owner-only",
        }),
    );
    await expect(
      runWithRequestContext({ userEmail: OUTSIDER }, () =>
        deleteContentSpaceAction.run({ spaceId: workspace.spaceId }),
      ),
    ).rejects.toThrow("Not authorized");
    await runWithRequestContext({ userEmail: WORKSPACE_OWNER }, () =>
      deleteContentSpaceAction.run({ spaceId: workspace.spaceId }),
    );
    const [remaining] = await getDb()
      .select({ id: schema.contentSpaces.id })
      .from(schema.contentSpaces)
      .where(eq(schema.contentSpaces.id, workspace.spaceId));
    expect(remaining).toBeUndefined();
  });

  it("binds concurrent workspace requests to one canonical name", async () => {
    const outcomes = await Promise.allSettled(
      ["Alpha", "Beta"].map((name) =>
        runWithRequestContext({ userEmail: WORKSPACE_OWNER }, () =>
          createContentSpaceAction.run({
            name,
            requestId: "concurrent-name-binding",
          }),
        ),
      ),
    );
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected"),
    ).toHaveLength(1);
    const fulfilled = outcomes.find(
      (outcome): outcome is PromiseFulfilledResult<any> =>
        outcome.status === "fulfilled",
    );
    const [space] = await getDb()
      .select()
      .from(schema.contentSpaces)
      .where(eq(schema.contentSpaces.id, fulfilled!.value.spaceId));
    expect(["Alpha", "Beta"]).toContain(space.name);
  });

  it("is idempotent, opaque, and creates exactly one Files, Workspaces, and Favorites database", async () => {
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
    const workspaces = databases.find(
      (database: any) => database.systemRole === "workspaces",
    );
    expect(
      databases.filter((database: any) => database.systemRole === "favorites"),
    ).toHaveLength(1);
    const files = databases.find(
      (database: any) => database.systemRole === "files",
    );
    expect(files.title).toBe("Personal");
    expect(JSON.parse(files.viewConfigJson)).toMatchObject({
      activeViewId: "default",
      views: [{ id: "default", type: "table", name: "Table" }],
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
    const filesItems = await getDb()
      .select()
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, files.id));
    expect(filesItems).toHaveLength(0);
    await runWithRequestContext({ userEmail: OWNER }, async () => {
      await expect(listContentSpacesAction.run({})).resolves.toMatchObject({
        catalogDatabaseId: workspaces.id,
        catalogDocumentId: workspaces.documentId,
        favoritesDatabaseId: first.favoritesDatabaseId,
        favoritesDocumentId: first.favoritesDocumentId,
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
      await expect(
        addDatabaseItemAction.run({
          databaseId: workspaces.id,
          title: "Not a workspace",
        }),
      ).rejects.toThrow("Use create-content-space to add a workspace");
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

  it("uses Favorites membership as a per-user state without replacing Files membership", async () => {
    const provisioned = await runWithRequestContext(
      { userEmail: WORKSPACE_OWNER },
      () => provisionContentSpaces(getDb(), WORKSPACE_OWNER),
    );
    const now = new Date().toISOString();
    await getDb().insert(schema.documents).values({
      id: "favorite-membership-page",
      ownerEmail: WORKSPACE_OWNER,
      orgId: null,
      spaceId: provisioned.personalSpaceId,
      title: "Membership page",
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    });
    await runWithRequestContext({ userEmail: WORKSPACE_OWNER }, () =>
      ensureContentSpacesAction.run({}),
    );

    const favorite = await runWithRequestContext(
      { userEmail: WORKSPACE_OWNER },
      () =>
        updateDocumentAction.run({
          id: "favorite-membership-page",
          isFavorite: true,
          reuseLabels: [],
        }),
    );
    expect(favorite.isFavorite).toBe(true);
    const memberships = await getDb()
      .select({ databaseId: schema.contentDatabaseItems.databaseId })
      .from(schema.contentDatabaseItems)
      .where(
        eq(schema.contentDatabaseItems.documentId, "favorite-membership-page"),
      );
    expect(memberships.map((row) => row.databaseId)).toEqual(
      expect.arrayContaining([
        provisioned.personalFilesDatabaseId,
        provisioned.favoritesDatabaseId,
      ]),
    );

    const unfavorite = await runWithRequestContext(
      { userEmail: WORKSPACE_OWNER },
      () =>
        updateDocumentAction.run({
          id: "favorite-membership-page",
          isFavorite: false,
          reuseLabels: [],
        }),
    );
    expect(unfavorite.isFavorite).toBe(false);
    const remainingMemberships = await getDb()
      .select({ databaseId: schema.contentDatabaseItems.databaseId })
      .from(schema.contentDatabaseItems)
      .where(
        eq(schema.contentDatabaseItems.documentId, "favorite-membership-page"),
      );
    expect(remainingMemberships.map((row) => row.databaseId)).toContain(
      provisioned.personalFilesDatabaseId,
    );
    expect(remainingMemberships.map((row) => row.databaseId)).not.toContain(
      provisioned.favoritesDatabaseId,
    );

    await runWithRequestContext({ userEmail: WORKSPACE_OWNER }, () =>
      updateDocumentAction.run({
        id: "favorite-membership-page",
        isFavorite: true,
        reuseLabels: [],
      }),
    );
    const removed = await runWithRequestContext(
      { userEmail: WORKSPACE_OWNER },
      () =>
        deleteDocumentAction.run({
          id: "favorite-membership-page",
          databaseDocumentId: provisioned.favoritesDocumentId,
        }),
    );
    expect(removed).toEqual({ success: true, deleted: 0, removed: 1 });
    await expect(
      getDb()
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(eq(schema.documents.id, "favorite-membership-page")),
    ).resolves.toHaveLength(1);
  });

  it("preserves the Content workspace name when the organization is renamed", async () => {
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
    expect(space?.name).toBe("Before rename");

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
    expect(reference?.title).toBe("Before rename");
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
    const filesProperties = await getDb()
      .select()
      .from(schema.documentPropertyDefinitions)
      .where(
        eq(schema.documentPropertyDefinitions.databaseId, filesDatabase!.id),
      );
    expect(filesProperties).toHaveLength(3);
    expect(filesProperties.map((property) => property.systemRole)).toEqual(
      expect.arrayContaining([null, "files_parent", "files_source"]),
    );
    await runWithRequestContext({ userEmail: MEMBER }, async () => {
      await expect(resolveContentSpaceAccess(spaceId)).resolves.toMatchObject({
        role: "viewer",
      });
      await expect(listContentSpacesAction.run({})).resolves.toMatchObject({
        spaces: expect.arrayContaining([
          expect.objectContaining({ id: spaceId, role: "viewer" }),
        ]),
      });
      await expect(
        getDocumentAction.run({ id: filesDatabase!.documentId }),
      ).resolves.toMatchObject({
        id: filesDatabase!.documentId,
        database: expect.objectContaining({ systemRole: "files" }),
        accessRole: "viewer",
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
      const [workspacesDatabase] = await getDb()
        .select()
        .from(schema.contentDatabases)
        .where(
          and(
            eq(schema.contentDatabases.ownerEmail, MEMBER),
            eq(schema.contentDatabases.systemRole, "workspaces"),
          ),
        );
      const catalog = await getContentDatabaseAction.run({
        databaseId: workspacesDatabase!.id,
      });
      expect(catalog.items.map((item) => item.document.title)).not.toContain(
        "Shared",
      );
    });
  });

  it("lists favorites across every authorized organization without admitting private or unrelated rows", async () => {
    const favoritesMember = "favorites-member@example.com";
    await addOrganization("org-favorites-a", "Favorites A");
    await addOrganization("org-favorites-b", "Favorites B");
    await addOrganization("org-favorites-other", "Favorites Other");
    await addMember("owner-favorites-a", "org-favorites-a", OWNER, "owner");
    await addMember("owner-favorites-b", "org-favorites-b", OWNER, "owner");
    await addMember(
      "owner-favorites-other",
      "org-favorites-other",
      OWNER,
      "owner",
    );
    await addMember("member-favorites-a", "org-favorites-a", favoritesMember);
    await addMember("member-favorites-b", "org-favorites-b", favoritesMember);
    await runWithRequestContext({ userEmail: OWNER }, () =>
      provisionContentSpaces(getDb(), OWNER),
    );
    const now = new Date().toISOString();
    await getDb()
      .insert(schema.documents)
      .values([
        {
          id: "favorite-org-a",
          ownerEmail: OWNER,
          orgId: "org-favorites-a",
          spaceId: organizationContentSpaceId("org-favorites-a"),
          title: "Favorite A",
          isFavorite: 1,
          visibility: "org",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "favorite-org-b",
          ownerEmail: OWNER,
          orgId: "org-favorites-b",
          spaceId: organizationContentSpaceId("org-favorites-b"),
          title: "Favorite B",
          isFavorite: 1,
          visibility: "org",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "private-org-a",
          ownerEmail: OWNER,
          orgId: "org-favorites-a",
          spaceId: organizationContentSpaceId("org-favorites-a"),
          title: "Private A",
          isFavorite: 1,
          visibility: "private",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "favorite-unrelated",
          ownerEmail: OWNER,
          orgId: "org-favorites-other",
          spaceId: organizationContentSpaceId("org-favorites-other"),
          title: "Unrelated",
          isFavorite: 1,
          visibility: "org",
          createdAt: now,
          updatedAt: now,
        },
      ]);

    const memberProvisioned = await runWithRequestContext(
      { userEmail: favoritesMember, orgId: "org-favorites-a" },
      () => provisionContentSpaces(getDb(), favoritesMember),
    );

    const result = await runWithRequestContext(
      { userEmail: favoritesMember, orgId: "org-favorites-a" },
      () => listDocumentsAction.run({}),
    );
    const ids = result.documents.map((document) => document.id);
    expect(ids).toEqual(
      expect.arrayContaining(["favorite-org-a", "favorite-org-b"]),
    );
    expect(ids).not.toContain("private-org-a");
    expect(ids).not.toContain("favorite-unrelated");
    const favorites = await runWithRequestContext(
      { userEmail: favoritesMember, orgId: "org-favorites-a" },
      () =>
        getContentDatabaseAction.run({
          databaseId: memberProvisioned.favoritesDatabaseId,
        }),
    );
    expect(favorites).toMatchObject({
      database: { systemRole: "favorites" },
      items: expect.arrayContaining([
        expect.objectContaining({
          document: expect.objectContaining({ id: "favorite-org-a" }),
        }),
        expect.objectContaining({
          document: expect.objectContaining({ id: "favorite-org-b" }),
        }),
      ]),
    });
    expect(
      "items" in favorites
        ? favorites.items.map((item) => item.document.id)
        : [],
    ).not.toEqual(
      expect.arrayContaining(["private-org-a", "favorite-unrelated"]),
    );

    await getDb().insert(schema.documentPropertyDefinitions).values({
      id: "favorites-personal-note",
      ownerEmail: favoritesMember,
      orgId: null,
      databaseId: memberProvisioned.favoritesDatabaseId,
      name: "Personal note",
      type: "text",
      position: 10,
      createdAt: now,
      updatedAt: now,
    });
    const propertyUpdate = await runWithRequestContext(
      { userEmail: favoritesMember, orgId: "org-favorites-a" },
      () =>
        setDocumentPropertyAction.run({
          documentId: "favorite-org-b",
          databaseId: memberProvisioned.favoritesDatabaseId,
          propertyId: "favorites-personal-note",
          value: "Cross-workspace metadata",
        }),
    );
    expect(propertyUpdate).toMatchObject({
      databaseId: memberProvisioned.favoritesDatabaseId,
      properties: expect.arrayContaining([
        expect.objectContaining({
          definition: expect.objectContaining({
            id: "favorites-personal-note",
          }),
          value: "Cross-workspace metadata",
        }),
      ]),
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
