import { createHash } from "node:crypto";
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
let getContentDatabasePersonalViewAction: typeof import("./get-content-database-personal-view.js").default;
let getDocumentAction: typeof import("./get-document.js").default;

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
  getContentDatabasePersonalViewAction = (
    await import("./get-content-database-personal-view.js")
  ).default;
  getDocumentAction = (await import("./get-document.js")).default;
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
  await getDbExec().execute({
    sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)",
    args: ["files-viewer-membership", ORG_ID, VIEWER, "member", Date.now()],
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
  it("exposes stable, derived Parent and Source properties", async () => {
    const spaceId = personalContentSpaceId(OWNER);
    const filesDatabase = await getFilesDatabase(spaceId);
    const now = new Date().toISOString();
    await getDb()
      .insert(schema.documents)
      .values([
        {
          id: "system-property-parent",
          ownerEmail: OWNER,
          orgId: null,
          spaceId,
          parentId: null,
          title: "Visible parent",
          content: "",
          description: "",
          position: 0,
          isFavorite: 0,
          hideFromSearch: 0,
          visibility: "private",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "system-property-child",
          ownerEmail: OWNER,
          orgId: null,
          spaceId,
          parentId: "system-property-parent",
          title: "Imported child",
          content: "",
          description: "",
          position: 1,
          isFavorite: 0,
          hideFromSearch: 0,
          visibility: "private",
          sourceMode: "local-files",
          sourceKind: "file",
          sourcePath: "notes.md",
          createdAt: now,
          updatedAt: now,
        },
      ]);
    await runWithRequestContext({ userEmail: OWNER }, () =>
      reconcileContentFilesMemberships(getDb(), OWNER),
    );
    const [childItem] = await getDb()
      .select()
      .from(schema.contentDatabaseItems)
      .where(
        and(
          eq(schema.contentDatabaseItems.databaseId, filesDatabase.id),
          eq(schema.contentDatabaseItems.documentId, "system-property-child"),
        ),
      );
    await getDb().insert(schema.contentDatabaseSources).values({
      id: "system-property-source",
      ownerEmail: OWNER,
      orgId: null,
      databaseId: filesDatabase.id,
      sourceType: "local-folder",
      sourceName: "Project notes",
      sourceTable: "opaque-connection",
      syncState: "linked",
      freshness: "fresh",
      capabilitiesJson: "{}",
      metadataJson: "{}",
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(schema.contentDatabaseSourceRows).values({
      id: "system-property-source-row",
      ownerEmail: OWNER,
      sourceId: "system-property-source",
      databaseItemId: childItem.id,
      documentId: "system-property-child",
      sourceRowId: "notes.md",
      sourceQualifiedId: "local-folder://opaque/notes.md",
      sourceDisplayKey: "notes.md",
      sourceValuesJson: "{}",
      provenance: "test",
      syncState: "linked",
      freshness: "fresh",
      createdAt: now,
      updatedAt: now,
    });

    const response = await runWithRequestContext({ userEmail: OWNER }, () =>
      getContentDatabaseAction.run({ databaseId: filesDatabase.id }),
    );
    const definitions = new Map(
      response.properties.map((property) => [
        property.definition.systemRole,
        property,
      ]),
    );
    expect(definitions.has("files_kind")).toBe(false);
    expect(definitions.get("files_parent")).toMatchObject({ editable: false });
    expect(definitions.get("files_source")).toMatchObject({ editable: false });
    expect(response.database.viewConfig.views[0]?.filters).toEqual([
      expect.objectContaining({
        key: definitions.get("files_parent")?.definition.id,
        operator: "is_empty",
        value: "",
      }),
    ]);
    const child = response.items.find(
      (item) => item.document.id === "system-property-child",
    )!;
    const values = new Map(
      child.properties.map((property) => [
        property.definition.systemRole,
        property.value,
      ]),
    );
    expect(values.get("files_parent")).toBe("system-property-parent");
    expect(values.get("files_source")).toEqual(["system-property-source"]);
    expect(
      definitions
        .get("files_parent")
        ?.definition.options.options?.find(
          (option) => option.id === "system-property-parent",
        )?.name,
    ).toBe("Visible parent");
    expect(
      definitions
        .get("files_source")
        ?.definition.options.options?.find(
          (option) => option.id === "system-property-source",
        )?.name,
    ).toBe("Project notes");
    expect(
      definitions
        .get("files_source")
        ?.definition.options.options?.find((option) => option.id === "local")
        ?.name,
    ).toBe("Content");

    await getDb()
      .delete(schema.contentDatabaseSourceRows)
      .where(
        eq(schema.contentDatabaseSourceRows.id, "system-property-source-row"),
      );
    await getDb()
      .delete(schema.contentDatabaseSources)
      .where(eq(schema.contentDatabaseSources.id, "system-property-source"));
    await getDb()
      .delete(schema.contentDatabaseItems)
      .where(
        inArray(schema.contentDatabaseItems.documentId, [
          "system-property-parent",
          "system-property-child",
        ]),
      );
    await getDb()
      .delete(schema.documents)
      .where(
        inArray(schema.documents.id, [
          "system-property-parent",
          "system-property-child",
        ]),
      );
  });

  it("rejects mutations of derived Files system properties", async () => {
    const filesDatabase = await getFilesDatabase(personalContentSpaceId(OWNER));
    const [parentProperty] = await getDb()
      .select()
      .from(schema.documentPropertyDefinitions)
      .where(
        and(
          eq(schema.documentPropertyDefinitions.databaseId, filesDatabase.id),
          eq(schema.documentPropertyDefinitions.systemRole, "files_parent"),
        ),
      );
    const [
      setProperty,
      configureProperty,
      deleteProperty,
      duplicateProperty,
      reorderProperty,
    ] = await Promise.all([
      import("./set-document-property.js").then((module) => module.default),
      import("./configure-document-property.js").then(
        (module) => module.default,
      ),
      import("./delete-document-property.js").then((module) => module.default),
      import("./duplicate-document-property.js").then(
        (module) => module.default,
      ),
      import("./reorder-document-property.js").then((module) => module.default),
    ]);
    const inOwnerContext = <T>(run: () => Promise<T>) =>
      runWithRequestContext({ userEmail: OWNER }, run);

    await expect(
      inOwnerContext(() =>
        setProperty.run({
          documentId: filesDatabase.documentId,
          propertyId: parentProperty.id,
          value: null,
        }),
      ),
    ).rejects.toThrow("derived");
    await expect(
      inOwnerContext(() =>
        configureProperty.run({
          id: parentProperty.id,
          documentId: filesDatabase.documentId,
          name: "Other",
          type: "select",
        }),
      ),
    ).rejects.toThrow("cannot be changed");
    await expect(
      inOwnerContext(() =>
        deleteProperty.run({
          documentId: filesDatabase.documentId,
          propertyId: parentProperty.id,
        }),
      ),
    ).rejects.toThrow("cannot be deleted");
    await expect(
      inOwnerContext(() =>
        duplicateProperty.run({
          documentId: filesDatabase.documentId,
          propertyId: parentProperty.id,
        }),
      ),
    ).rejects.toThrow("cannot be duplicated");
    const [contentProperty] = await getDb()
      .select()
      .from(schema.documentPropertyDefinitions)
      .where(
        and(
          eq(schema.documentPropertyDefinitions.databaseId, filesDatabase.id),
          eq(schema.documentPropertyDefinitions.type, "blocks"),
        ),
      );
    await expect(
      inOwnerContext(() =>
        reorderProperty.run({
          documentId: filesDatabase.documentId,
          propertyId: parentProperty.id,
          targetPropertyId: contentProperty.id,
          position: "before",
        }),
      ),
    ).rejects.toThrow("cannot be reordered");
  });

  it("keeps complete Files inventory available for client-side filtered pagination", async () => {
    const { defaultFilesDatabaseViewConfig } =
      await import("./_files-system-properties.js");
    const { serializeDatabaseViewConfig } =
      await import("./_property-utils.js");
    const filesDatabase = await getFilesDatabase(personalContentSpaceId(OWNER));
    const originalViewConfigJson = filesDatabase.viewConfigJson;
    const now = new Date().toISOString();
    const containingDatabaseDocumentId = "pagination-containing-database";
    const containingDatabaseId = "pagination-containing-database-record";
    const rowDocumentIds = Array.from(
      { length: 101 },
      (_, index) => `pagination-database-row-${index}`,
    );
    const topLevelDocumentId = "pagination-top-level-page";
    const testDocumentIds = [
      containingDatabaseDocumentId,
      ...rowDocumentIds,
      topLevelDocumentId,
    ];
    await getDb()
      .update(schema.contentDatabases)
      .set({
        viewConfigJson: serializeDatabaseViewConfig(
          defaultFilesDatabaseViewConfig(filesDatabase.id),
        ),
      })
      .where(eq(schema.contentDatabases.id, filesDatabase.id));
    await getDb()
      .insert(schema.documents)
      .values(
        testDocumentIds.map((id, position) => ({
          id,
          ownerEmail: OWNER,
          spaceId: filesDatabase.spaceId,
          title: id === topLevelDocumentId ? "Later top-level page" : id,
          content: "",
          parentId: rowDocumentIds.includes(id)
            ? containingDatabaseDocumentId
            : null,
          position,
          visibility: "private",
          createdAt: now,
          updatedAt: now,
        })),
      );
    await getDb().insert(schema.contentDatabases).values({
      id: containingDatabaseId,
      ownerEmail: OWNER,
      spaceId: filesDatabase.spaceId,
      documentId: containingDatabaseDocumentId,
      title: "Containing database",
      createdAt: now,
      updatedAt: now,
    });
    await getDb()
      .insert(schema.contentDatabaseItems)
      .values([
        ...rowDocumentIds.map((documentId, position) => ({
          id: `pagination-containing-item-${position}`,
          ownerEmail: OWNER,
          databaseId: containingDatabaseId,
          documentId,
          position,
          createdAt: now,
          updatedAt: now,
        })),
        ...rowDocumentIds.map((documentId, position) => ({
          id: `pagination-files-item-${position}`,
          ownerEmail: OWNER,
          databaseId: filesDatabase.id,
          documentId,
          position,
          createdAt: now,
          updatedAt: now,
        })),
        {
          id: "pagination-files-top-level-item",
          ownerEmail: OWNER,
          databaseId: filesDatabase.id,
          documentId: topLevelDocumentId,
          position: rowDocumentIds.length,
          createdAt: now,
          updatedAt: now,
        },
      ]);

    const firstPage = await runWithRequestContext({ userEmail: OWNER }, () =>
      getContentDatabaseAction.run({
        databaseId: filesDatabase.id,
        limit: 100,
      }),
    );
    expect(firstPage.items).toHaveLength(100);
    expect(firstPage.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          document: expect.objectContaining({ id: topLevelDocumentId }),
        }),
      ]),
    );
    expect(firstPage.pagination).toEqual({
      offset: 0,
      limit: 100,
      totalItems: 102,
      returnedItems: 100,
      hasMore: true,
    });
    const expanded = await runWithRequestContext({ userEmail: OWNER }, () =>
      getContentDatabaseAction.run({
        databaseId: filesDatabase.id,
        limit: 102,
      }),
    );
    expect(expanded.items).toHaveLength(102);
    expect(expanded.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          document: expect.objectContaining({ id: topLevelDocumentId }),
        }),
      ]),
    );
    expect(expanded.pagination).toEqual({
      offset: 0,
      limit: 102,
      totalItems: 102,
      returnedItems: 102,
      hasMore: false,
    });

    await getDb()
      .delete(schema.contentDatabaseItems)
      .where(inArray(schema.contentDatabaseItems.documentId, testDocumentIds));
    await getDb()
      .delete(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, containingDatabaseId));
    await getDb()
      .delete(schema.documents)
      .where(inArray(schema.documents.id, testDocumentIds));
    await getDb()
      .update(schema.contentDatabases)
      .set({ viewConfigJson: originalViewConfigJson })
      .where(eq(schema.contentDatabases.id, filesDatabase.id));
  });

  it("does not hide org-visible files because of an unreadable private database membership", async () => {
    const orgSpaceId = organizationContentSpaceId(ORG_ID);
    const filesDatabase = await getFilesDatabase(orgSpaceId);
    const now = new Date().toISOString();
    const privateDatabaseDocumentId = "private-containing-database-document";
    const privateDatabaseId = "private-containing-database";
    const visibleDocumentId = "private-membership-visible-org-page";
    await getDb()
      .insert(schema.documents)
      .values([
        {
          id: privateDatabaseDocumentId,
          ownerEmail: OWNER,
          orgId: ORG_ID,
          spaceId: orgSpaceId,
          title: "Owner private database",
          content: "",
          visibility: "private",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: visibleDocumentId,
          ownerEmail: OWNER,
          orgId: ORG_ID,
          spaceId: orgSpaceId,
          title: "Visible organization page",
          content: "",
          visibility: "org",
          createdAt: now,
          updatedAt: now,
        },
      ]);
    await getDb().insert(schema.contentDatabases).values({
      id: privateDatabaseId,
      ownerEmail: OWNER,
      orgId: ORG_ID,
      spaceId: orgSpaceId,
      documentId: privateDatabaseDocumentId,
      title: "Owner private database",
      createdAt: now,
      updatedAt: now,
    });
    await getDb()
      .insert(schema.contentDatabaseItems)
      .values([
        {
          id: "private-containing-database-item",
          ownerEmail: OWNER,
          orgId: ORG_ID,
          databaseId: privateDatabaseId,
          documentId: visibleDocumentId,
          position: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "private-containing-files-item",
          ownerEmail: OWNER,
          orgId: ORG_ID,
          databaseId: filesDatabase.id,
          documentId: visibleDocumentId,
          position: 0,
          createdAt: now,
          updatedAt: now,
        },
      ]);

    const response = await runWithRequestContext(
      { userEmail: VIEWER, orgId: ORG_ID },
      () => getContentDatabaseAction.run({ databaseId: filesDatabase.id }),
    );
    const visibleItem = response.items.find(
      (item) => item.document.id === visibleDocumentId,
    );
    expect(visibleItem?.document.title).toBe("Visible organization page");
    expect(
      visibleItem?.properties.some(
        (property) => property.definition.systemRole === "files_kind",
      ),
    ).toBe(false);
    expect(JSON.stringify(response)).not.toContain("Owner private database");

    await getDb()
      .delete(schema.contentDatabaseItems)
      .where(
        inArray(schema.contentDatabaseItems.documentId, [visibleDocumentId]),
      );
    await getDb()
      .delete(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, privateDatabaseId));
    await getDb()
      .delete(schema.documents)
      .where(
        inArray(schema.documents.id, [
          privateDatabaseDocumentId,
          visibleDocumentId,
        ]),
      );
  });

  it("repairs only unseeded Files defaults and preserves a cleared filter", async () => {
    const { repairFilesSystemPropertyDefinitions } =
      await import("./_files-system-properties.js");
    const { defaultDatabaseViewConfig, serializeDatabaseViewConfig } =
      await import("./_property-utils.js");
    const filesDatabase = await getFilesDatabase(personalContentSpaceId(OWNER));
    const legacyDefault = serializeDatabaseViewConfig(
      defaultDatabaseViewConfig("sidebar"),
    );
    await getDb()
      .update(schema.contentDatabases)
      .set({
        filesSystemPropertiesSeeded: 0,
        viewConfigJson: legacyDefault,
      })
      .where(eq(schema.contentDatabases.id, filesDatabase.id));

    await expect(repairFilesSystemPropertyDefinitions()).resolves.toBe(1);
    const [repaired] = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, filesDatabase.id));
    expect(repaired.filesSystemPropertiesSeeded).toBe(1);
    expect(repaired.viewConfigJson).toContain('"operator":"is_empty"');
    expect(repaired.viewConfigJson).not.toContain("database_row");

    await getDb()
      .update(schema.contentDatabases)
      .set({ viewConfigJson: legacyDefault })
      .where(eq(schema.contentDatabases.id, filesDatabase.id));
    await expect(repairFilesSystemPropertyDefinitions()).resolves.toBe(0);
    const [afterClearing] = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, filesDatabase.id));
    expect(afterClearing.viewConfigJson).toBe(legacyDefault);
  });

  it("migrates the legacy Kind default while preserving saved filters", async () => {
    const { ensureFilesSystemPropertyDefinitions, filesParentPropertyId } =
      await import("./_files-system-properties.js");
    const { defaultDatabaseViewConfig, serializeDatabaseViewConfig } =
      await import("./_property-utils.js");
    const filesDatabase = await getFilesDatabase(personalContentSpaceId(OWNER));
    const originalViewConfigJson = filesDatabase.viewConfigJson;
    const legacyKindPropertyId = `content_files_property_${createHash("sha256")
      .update(`${filesDatabase.id}:files_kind`)
      .digest("hex")
      .slice(0, 32)}`;
    const savedTitleFilter = {
      key: "name" as const,
      label: "Name",
      operator: "contains" as const,
      value: "plan",
    };
    const legacyDefaultFilter = {
      key: legacyKindPropertyId,
      label: "Kind",
      operator: "does_not_equal" as const,
      value: "database_row",
    };
    const legacyConfig = defaultDatabaseViewConfig("table");
    legacyConfig.filters = [legacyDefaultFilter, savedTitleFilter];
    legacyConfig.views[0]!.filters = [legacyDefaultFilter, savedTitleFilter];
    const legacyViewConfigJson = serializeDatabaseViewConfig(legacyConfig);

    await getDb()
      .update(schema.contentDatabases)
      .set({
        filesSystemPropertiesSeeded: 1,
        viewConfigJson: legacyViewConfigJson,
      })
      .where(eq(schema.contentDatabases.id, filesDatabase.id));
    try {
      await ensureFilesSystemPropertyDefinitions({
        database: { ...filesDatabase, viewConfigJson: legacyViewConfigJson },
      });
      const [migrated] = await getDb()
        .select()
        .from(schema.contentDatabases)
        .where(eq(schema.contentDatabases.id, filesDatabase.id));
      const parsed = JSON.parse(migrated.viewConfigJson);
      expect(parsed.views[0].filters).toEqual([
        {
          key: filesParentPropertyId(filesDatabase.id),
          label: "Parent",
          operator: "is_empty",
          value: "",
        },
        savedTitleFilter,
      ]);
    } finally {
      await getDb()
        .update(schema.contentDatabases)
        .set({ viewConfigJson: originalViewConfigJson })
        .where(eq(schema.contentDatabases.id, filesDatabase.id));
    }
  });

  it("adopts a legacy multi-source Files Source property without losing values", async () => {
    const { ensureFilesSystemPropertyDefinitions } =
      await import("./_files-system-properties.js");
    const { ensureDatabaseSourceProperty } =
      await import("./_database-source-utils.js");
    const now = new Date().toISOString();
    await getDb().insert(schema.documents).values({
      id: "legacy-source-files-document",
      spaceId: "legacy-source-space",
      ownerEmail: OWNER,
      title: "Files",
      content: "",
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(schema.contentDatabases).values({
      id: "legacy-source-files-database",
      spaceId: "legacy-source-space",
      ownerEmail: OWNER,
      documentId: "legacy-source-files-document",
      title: "Files",
      systemRole: "files",
      viewConfigJson: "{}",
      createdAt: now,
      updatedAt: now,
    });
    await getDb()
      .insert(schema.contentDatabaseSources)
      .values([
        {
          id: "legacy-source-one",
          ownerEmail: OWNER,
          databaseId: "legacy-source-files-database",
          sourceType: "local-folder",
          sourceName: "One",
          sourceTable: "one",
          syncState: "linked",
          freshness: "fresh",
          capabilitiesJson: "{}",
          metadataJson: "{}",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "legacy-source-two",
          ownerEmail: OWNER,
          databaseId: "legacy-source-files-database",
          sourceType: "local-folder",
          sourceName: "Two",
          sourceTable: "two",
          syncState: "linked",
          freshness: "fresh",
          capabilitiesJson: "{}",
          metadataJson: "{}",
          createdAt: now,
          updatedAt: now,
        },
      ]);
    await getDb()
      .insert(schema.documentPropertyDefinitions)
      .values({
        id: "legacy-source-property",
        ownerEmail: OWNER,
        databaseId: "legacy-source-files-database",
        name: "Source",
        type: "select",
        optionsJson: JSON.stringify({
          options: [
            { id: "legacy-source-one", name: "One", color: "blue" },
            { id: "legacy-source-two", name: "Two", color: "green" },
            { id: "local", name: "Local", color: "gray" },
          ],
        }),
        position: 0,
        createdAt: now,
        updatedAt: now,
      });
    await getDb().insert(schema.documentPropertyValues).values({
      id: "legacy-source-value",
      ownerEmail: OWNER,
      documentId: "legacy-source-files-document",
      propertyId: "legacy-source-property",
      valueJson: '"local"',
      createdAt: now,
      updatedAt: now,
    });
    const [database] = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, "legacy-source-files-database"));
    await ensureFilesSystemPropertyDefinitions({ database, now });
    const [seededDatabase] = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, database.id));
    await ensureDatabaseSourceProperty({ database: seededDatabase, now });

    const sourceProperties = await getDb()
      .select()
      .from(schema.documentPropertyDefinitions)
      .where(
        and(
          eq(schema.documentPropertyDefinitions.databaseId, database.id),
          eq(schema.documentPropertyDefinitions.name, "Source"),
        ),
      );
    expect(sourceProperties).toEqual([
      expect.objectContaining({
        id: "legacy-source-property",
        systemRole: "files_source",
        type: "multi_select",
      }),
    ]);
    await expect(
      getDb()
        .select()
        .from(schema.documentPropertyValues)
        .where(eq(schema.documentPropertyValues.id, "legacy-source-value")),
    ).resolves.toEqual([
      expect.objectContaining({
        propertyId: "legacy-source-property",
        valueJson: '"local"',
      }),
    ]);

    await getDb()
      .delete(schema.documentPropertyValues)
      .where(eq(schema.documentPropertyValues.id, "legacy-source-value"));
    await getDb()
      .delete(schema.documentPropertyDefinitions)
      .where(
        eq(
          schema.documentPropertyDefinitions.databaseId,
          "legacy-source-files-database",
        ),
      );
    await getDb()
      .delete(schema.contentDatabaseSources)
      .where(
        eq(
          schema.contentDatabaseSources.databaseId,
          "legacy-source-files-database",
        ),
      );
    await getDb()
      .delete(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, "legacy-source-files-database"));
    await getDb()
      .delete(schema.documents)
      .where(eq(schema.documents.id, "legacy-source-files-document"));
  });

  it("leaves a user-created Source property untouched", async () => {
    const { ensureFilesSystemPropertyDefinitions } =
      await import("./_files-system-properties.js");
    const now = new Date().toISOString();
    const documentId = "custom-source-files-document";
    const databaseId = "custom-source-files-database";
    await getDb().insert(schema.documents).values({
      id: documentId,
      spaceId: "custom-source-space",
      ownerEmail: OWNER,
      title: "Files",
      content: "",
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(schema.contentDatabases).values({
      id: databaseId,
      spaceId: "custom-source-space",
      ownerEmail: OWNER,
      documentId,
      title: "Files",
      systemRole: "files",
      viewConfigJson: "{}",
      createdAt: now,
      updatedAt: now,
    });
    await getDb()
      .insert(schema.documentPropertyDefinitions)
      .values({
        id: "custom-source-property",
        ownerEmail: OWNER,
        databaseId,
        name: "Source",
        type: "select",
        optionsJson: JSON.stringify({
          options: [
            { id: "internal", name: "Internal", color: "blue" },
            { id: "external", name: "External", color: "green" },
          ],
        }),
        position: 0,
        createdAt: now,
        updatedAt: now,
      });
    const [database] = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, databaseId));
    await ensureFilesSystemPropertyDefinitions({ database, now });

    const sourceProperties = await getDb()
      .select()
      .from(schema.documentPropertyDefinitions)
      .where(
        and(
          eq(schema.documentPropertyDefinitions.databaseId, databaseId),
          eq(schema.documentPropertyDefinitions.name, "Source"),
        ),
      );
    expect(sourceProperties).toHaveLength(2);
    expect(sourceProperties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "custom-source-property",
          systemRole: null,
          type: "select",
        }),
        expect.objectContaining({
          systemRole: "files_source",
          type: "multi_select",
        }),
      ]),
    );

    await getDb()
      .delete(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.databaseId, databaseId));
    await getDb()
      .delete(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, databaseId));
    await getDb()
      .delete(schema.documents)
      .where(eq(schema.documents.id, documentId));
  });

  it("removes system databases and workspace references from Personal Files", async () => {
    const personalSpaceId = personalContentSpaceId(OWNER);
    const personalFiles = await getFilesDatabase(personalSpaceId);
    const [workspacesDatabase] = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(
        and(
          eq(schema.contentDatabases.spaceId, personalSpaceId),
          eq(schema.contentDatabases.systemRole, "workspaces"),
        ),
      );
    const [workspaceReference] = await getDb()
      .select()
      .from(schema.contentSpaceCatalogItems)
      .where(
        eq(
          schema.contentSpaceCatalogItems.catalogDatabaseId,
          workspacesDatabase.id,
        ),
      );
    const now = new Date().toISOString();
    await getDb()
      .insert(schema.contentDatabaseItems)
      .values([
        {
          id: "legacy-workspaces-files-item",
          ownerEmail: OWNER,
          orgId: null,
          databaseId: personalFiles.id,
          documentId: workspacesDatabase.documentId,
          position: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "legacy-workspace-reference-files-item",
          ownerEmail: OWNER,
          orgId: null,
          databaseId: personalFiles.id,
          documentId: workspaceReference.documentId,
          position: 1,
          createdAt: now,
          updatedAt: now,
        },
      ]);

    await runWithRequestContext({ userEmail: OWNER }, () =>
      reconcileContentFilesMemberships(getDb(), OWNER),
    );

    const staleItems = await getDb()
      .select()
      .from(schema.contentDatabaseItems)
      .where(
        and(
          eq(schema.contentDatabaseItems.databaseId, personalFiles.id),
          inArray(schema.contentDatabaseItems.documentId, [
            workspacesDatabase.documentId,
            workspaceReference.documentId,
          ]),
        ),
      );
    expect(staleItems).toHaveLength(0);
  });

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
    await createLegacyDocument({
      id: "hidden-org-page",
      orgId: viewerOrgId,
      title: "Hidden organization page",
    });
    await getDb()
      .update(schema.documents)
      .set({
        content: "Keep this body exactly",
        icon: "📚",
        parentId: "owner-private-org",
      })
      .where(eq(schema.documents.id, "viewer-legacy-org"));
    await getDb()
      .update(schema.documents)
      .set({ visibility: "private" })
      .where(eq(schema.documents.id, "owner-private-org"));
    await getDb()
      .update(schema.documents)
      .set({ hideFromSearch: 1 })
      .where(eq(schema.documents.id, "hidden-org-page"));
    await getDb().insert(schema.documentShares).values({
      id: "viewer-visible-editor-share",
      resourceId: "viewer-legacy-org",
      principalType: "user",
      principalId: VIEWER,
      role: "editor",
      createdBy: OWNER,
      createdAt: new Date().toISOString(),
    });
    const [before] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, "viewer-legacy-org"));
    const [privateBefore] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, "owner-private-org"));

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
    const [privateAfter] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, "owner-private-org"));
    expect(privateAfter).toEqual(privateBefore);
    const filesDatabase = await getFilesDatabase(
      organizationContentSpaceId(viewerOrgId),
    );
    for (const [documentId, position] of [
      ["owner-private-org", 0],
      ["hidden-org-page", 1],
      ["viewer-legacy-org", 2],
    ] as const) {
      await getDb()
        .update(schema.contentDatabaseItems)
        .set({ position })
        .where(
          and(
            eq(schema.contentDatabaseItems.databaseId, filesDatabase.id),
            eq(schema.contentDatabaseItems.documentId, documentId),
          ),
        );
    }
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
      () =>
        getContentDatabaseAction.run({
          databaseId: filesDatabase.id,
          limit: 1,
        }),
    );
    expect(databaseResponse).toMatchObject({
      database: { id: filesDatabase.id, systemRole: "files" },
      pagination: {
        totalItems: 1,
        returnedItems: 1,
        hasMore: false,
      },
      items: expect.arrayContaining([
        expect.objectContaining({
          document: expect.objectContaining({
            id: "viewer-legacy-org",
            title: "Member can reconcile",
            accessRole: "editor",
            canEdit: true,
            canManage: false,
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
    const visibleItem = databaseResponse.items.find(
      (item) => item.document.id === "viewer-legacy-org",
    )!;
    expect(
      visibleItem.properties.find(
        (property) => property.definition.systemRole === "files_parent",
      )?.value,
    ).toBeNull();
    expect(JSON.stringify(databaseResponse)).not.toContain(
      "Owner private page",
    );
    expect(databaseResponse.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          document: expect.objectContaining({ id: "hidden-org-page" }),
        }),
      ]),
    );
    const crossWorkspaceResponse = await runWithRequestContext(
      { userEmail: VIEWER, orgId: ORG_ID },
      () =>
        getContentDatabaseAction.run({
          databaseId: filesDatabase.id,
        }),
    );
    expect(crossWorkspaceResponse.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          document: expect.objectContaining({ id: "viewer-legacy-org" }),
        }),
      ]),
    );
    await expect(
      runWithRequestContext({ userEmail: VIEWER, orgId: ORG_ID }, () =>
        getContentDatabasePersonalViewAction.run(
          { databaseId: filesDatabase.id },
          { userEmail: VIEWER } as any,
        ),
      ),
    ).resolves.toMatchObject({
      databaseId: filesDatabase.id,
      overrides: null,
    });
    const openedDocument = await runWithRequestContext(
      { userEmail: VIEWER, orgId: viewerOrgId },
      () => getDocumentAction.run({ id: "viewer-legacy-org" }),
    );
    expect(openedDocument).toMatchObject({
      id: "viewer-legacy-org",
      title: "Member can reconcile",
      content: "Keep this body exactly",
      accessRole: "editor",
      canEdit: true,
    });
    await getDb()
      .delete(schema.documents)
      .where(
        inArray(schema.documents.id, [
          "viewer-legacy-org",
          "owner-private-org",
          "hidden-org-page",
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

  it("does not expose private source rows or change sets through organization Files", async () => {
    await createLegacyDocument({
      id: "source-visible-org",
      orgId: ORG_ID,
      title: "Visible source row",
    });
    await createLegacyDocument({
      id: "source-private-org",
      orgId: ORG_ID,
      title: "Private source row",
    });
    await getDb()
      .update(schema.documents)
      .set({ visibility: "private" })
      .where(eq(schema.documents.id, "source-private-org"));
    await runWithRequestContext({ userEmail: OWNER, orgId: ORG_ID }, () =>
      reconcileContentFilesMemberships(getDb(), OWNER),
    );
    const filesDatabase = await getFilesDatabase(
      organizationContentSpaceId(ORG_ID),
    );
    const items = await getDb()
      .select()
      .from(schema.contentDatabaseItems)
      .where(
        and(
          eq(schema.contentDatabaseItems.databaseId, filesDatabase.id),
          inArray(schema.contentDatabaseItems.documentId, [
            "source-visible-org",
            "source-private-org",
          ]),
        ),
      );
    const itemByDocumentId = new Map(
      items.map((item: any) => [item.documentId, item]),
    );
    const now = new Date().toISOString();
    await getDb().insert(schema.contentDatabaseSources).values({
      id: "private-boundary-source",
      ownerEmail: OWNER,
      orgId: ORG_ID,
      databaseId: filesDatabase.id,
      sourceType: "local-folder",
      sourceName: "Private boundary source",
      sourceTable: "private-boundary",
      createdAt: now,
      updatedAt: now,
    });
    for (const documentId of ["source-visible-org", "source-private-org"]) {
      const item = itemByDocumentId.get(documentId);
      if (!item) throw new Error(`Missing Files item for ${documentId}`);
      await getDb()
        .insert(schema.contentDatabaseSourceRows)
        .values({
          id: `${documentId}-source-row`,
          ownerEmail: OWNER,
          sourceId: "private-boundary-source",
          databaseItemId: item.id,
          documentId,
          sourceRowId: documentId,
          sourceQualifiedId: `source:${documentId}`,
          sourceDisplayKey: documentId,
          sourceValuesJson: JSON.stringify({ secret: documentId }),
          createdAt: now,
          updatedAt: now,
        });
      await getDb()
        .insert(schema.contentDatabaseSourceChangeSets)
        .values({
          id: `${documentId}-change-set`,
          ownerEmail: OWNER,
          sourceId: "private-boundary-source",
          databaseItemId: item.id,
          documentId,
          summary: `Change for ${documentId}`,
          createdAt: now,
          updatedAt: now,
        });
    }

    const response = await runWithRequestContext(
      { userEmail: VIEWER, orgId: ORG_ID },
      () => getContentDatabaseAction.run({ databaseId: filesDatabase.id }),
    );
    expect(response.sources[0]?.rows.map((row) => row.documentId)).toContain(
      "source-visible-org",
    );
    expect(
      response.sources[0]?.rows.map((row) => row.documentId),
    ).not.toContain("source-private-org");
    expect(
      response.sources[0]?.changeSets.map((changeSet) => changeSet.documentId),
    ).toContain("source-visible-org");
    expect(
      response.sources[0]?.changeSets.map((changeSet) => changeSet.documentId),
    ).not.toContain("source-private-org");

    await getDb()
      .delete(schema.contentDatabaseSourceChangeSets)
      .where(
        eq(
          schema.contentDatabaseSourceChangeSets.sourceId,
          "private-boundary-source",
        ),
      );
    await getDb()
      .delete(schema.contentDatabaseSourceRows)
      .where(
        eq(
          schema.contentDatabaseSourceRows.sourceId,
          "private-boundary-source",
        ),
      );
    await getDb()
      .delete(schema.contentDatabaseSources)
      .where(eq(schema.contentDatabaseSources.id, "private-boundary-source"));
    await getDb()
      .delete(schema.contentDatabaseItems)
      .where(
        inArray(schema.contentDatabaseItems.documentId, [
          "source-visible-org",
          "source-private-org",
        ]),
      );
    await getDb()
      .delete(schema.documents)
      .where(
        inArray(schema.documents.id, [
          "source-visible-org",
          "source-private-org",
        ]),
      );
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
