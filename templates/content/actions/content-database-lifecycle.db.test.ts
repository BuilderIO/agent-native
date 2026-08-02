import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { serializeRegistryBlockToMdx } from "../shared/nfm-registry.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-database-lifecycle-${process.pid}-${Date.now()}.sqlite`,
);

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let updateDocumentAction: typeof import("./update-document.js").default;
let moveDocumentAction: typeof import("./move-document.js").default;
let deleteContentDatabaseAction: typeof import("./delete-content-database.js").default;
let restoreContentDatabaseAction: typeof import("./restore-content-database.js").default;
let getContentDatabaseAction: typeof import("./get-content-database.js").default;
let queryContentDatabaseItemsAction: typeof import("./query-content-database-items.js").default;
let listDocumentsAction: typeof import("./list-documents.js").default;
let listTrashedContentDatabasesAction: typeof import("./list-trashed-content-databases.js").default;
let getDocumentAction: typeof import("./get-document.js").default;
let pullDocumentAction: typeof import("./pull-document.js").default;
let listDocumentPropertiesAction: typeof import("./list-document-properties.js").default;
let configureDocumentPropertyAction: typeof import("./configure-document-property.js").default;
let setDocumentPropertyAction: typeof import("./set-document-property.js").default;
let duplicateDocumentPropertyAction: typeof import("./duplicate-document-property.js").default;
let deleteDocumentPropertyAction: typeof import("./delete-document-property.js").default;
let reorderDocumentPropertyAction: typeof import("./reorder-document-property.js").default;
let addDatabaseItemAction: typeof import("./add-database-item.js").default;
let deleteDocumentAction: typeof import("./delete-document.js").default;
let restoreDocumentAction: typeof import("./restore-document.js").default;
let permanentlyDeleteDocumentAction: typeof import("./permanently-delete-document.js").default;
let listTrashedDocumentsAction: typeof import("./list-trashed-documents.js").default;

const OWNER = "owner@example.com";
const COLLABORATOR = "collaborator@example.com";

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  updateDocumentAction = (await import("./update-document.js")).default;
  moveDocumentAction = (await import("./move-document.js")).default;
  deleteContentDatabaseAction = (await import("./delete-content-database.js"))
    .default;
  restoreContentDatabaseAction = (await import("./restore-content-database.js"))
    .default;
  getContentDatabaseAction = (await import("./get-content-database.js"))
    .default;
  queryContentDatabaseItemsAction = (
    await import("./query-content-database-items.js")
  ).default;
  listDocumentsAction = (await import("./list-documents.js")).default;
  listTrashedContentDatabasesAction = (
    await import("./list-trashed-content-databases.js")
  ).default;
  getDocumentAction = (await import("./get-document.js")).default;
  pullDocumentAction = (await import("./pull-document.js")).default;
  listDocumentPropertiesAction = (await import("./list-document-properties.js"))
    .default;
  configureDocumentPropertyAction = (
    await import("./configure-document-property.js")
  ).default;
  setDocumentPropertyAction = (await import("./set-document-property.js"))
    .default;
  duplicateDocumentPropertyAction = (
    await import("./duplicate-document-property.js")
  ).default;
  deleteDocumentPropertyAction = (await import("./delete-document-property.js"))
    .default;
  reorderDocumentPropertyAction = (
    await import("./reorder-document-property.js")
  ).default;
  addDatabaseItemAction = (await import("./add-database-item.js")).default;
  deleteDocumentAction = (await import("./delete-document.js")).default;
  restoreDocumentAction = (await import("./restore-document.js")).default;
  permanentlyDeleteDocumentAction = (
    await import("./permanently-delete-document.js")
  ).default;
  listTrashedDocumentsAction = (await import("./list-trashed-documents.js"))
    .default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

let counter = 0;

function nextId(prefix: string) {
  counter += 1;
  return `${prefix}_${counter}_${Math.random().toString(36).slice(2, 8)}`;
}

function inlineDatabaseBlock(args: {
  blockId: string;
  databaseId: string;
  databaseDocumentId: string;
}) {
  return serializeRegistryBlockToMdx("inline-database", {
    id: args.blockId,
    data: {
      databaseId: args.databaseId,
      databaseDocumentId: args.databaseDocumentId,
      ownerBlockId: args.blockId,
    },
  });
}

async function createDocument(args: {
  id?: string;
  parentId?: string | null;
  title?: string;
  content?: string;
  position?: number;
  visibility?: "private" | "org" | "public";
  orgId?: string | null;
  ownerEmail?: string;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const id = args.id ?? nextId("doc");
  await db.insert(schema.documents).values({
    id,
    ownerEmail: args.ownerEmail ?? OWNER,
    parentId: args.parentId ?? null,
    title: args.title ?? "Untitled",
    content: args.content ?? "",
    position: args.position ?? 0,
    visibility: args.visibility ?? "private",
    orgId: args.orgId ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function documentRow(documentId: string, ownerEmail = OWNER) {
  const db = getDb();
  const [document] = await db
    .select()
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, documentId),
        eq(schema.documents.ownerEmail, ownerEmail),
      ),
    );
  return document;
}

async function createDatabase(args: {
  hostDocumentId?: string | null;
  ownerBlockId?: string | null;
  backingParentId?: string | null;
  deletedAt?: string | null;
  ownerEmail?: string;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const databaseId = nextId("db");
  const databaseDocumentId = await createDocument({
    id: nextId("dbdoc"),
    parentId: args.backingParentId ?? args.hostDocumentId ?? null,
    title: "Database",
    ownerEmail: args.ownerEmail,
  });
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: args.ownerEmail ?? OWNER,
    documentId: databaseDocumentId,
    ownerDocumentId: args.hostDocumentId ?? null,
    ownerBlockId: args.ownerBlockId ?? null,
    title: "Database",
    deletedAt: args.deletedAt ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return { databaseId, databaseDocumentId };
}

async function databaseRow(databaseId: string) {
  const db = getDb();
  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, databaseId));
  return database;
}

describe("database-scoped document properties", () => {
  it("accepts legacy context-free property action inputs", async () => {
    const missingDocumentId = nextId("missing_document");
    const missingPropertyId = nextId("missing_property");
    const runAsOwner = <T>(run: () => Promise<T>) =>
      runWithRequestContext({ userEmail: OWNER }, run);

    await expect(
      runAsOwner(() =>
        listDocumentPropertiesAction.run({ documentId: missingDocumentId }),
      ),
    ).rejects.toThrow(`Document "${missingDocumentId}" not found`);
    await expect(
      runAsOwner(() =>
        configureDocumentPropertyAction.run({
          documentId: missingDocumentId,
          name: "Legacy property",
          type: "text",
        }),
      ),
    ).rejects.toThrow(`No access to document ${missingDocumentId}`);
    await expect(
      runAsOwner(() =>
        setDocumentPropertyAction.run({
          documentId: missingDocumentId,
          propertyId: missingPropertyId,
          value: "Legacy value",
        }),
      ),
    ).rejects.toThrow(`Property "${missingPropertyId}" not found`);
    await expect(
      runAsOwner(() =>
        duplicateDocumentPropertyAction.run({
          documentId: missingDocumentId,
          propertyId: missingPropertyId,
        }),
      ),
    ).rejects.toThrow(`No access to document ${missingDocumentId}`);
    await expect(
      runAsOwner(() =>
        deleteDocumentPropertyAction.run({
          documentId: missingDocumentId,
          propertyId: missingPropertyId,
        }),
      ),
    ).rejects.toThrow(`No access to document ${missingDocumentId}`);
    await expect(
      runAsOwner(() =>
        reorderDocumentPropertyAction.run({
          documentId: missingDocumentId,
          propertyId: missingPropertyId,
          targetPropertyId: nextId("missing_target_property"),
        }),
      ),
    ).rejects.toThrow(`No access to document ${missingDocumentId}`);
  });

  it("keeps reads and Add property mutations on the requested membership", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const rowDocumentId = await createDocument({ title: "Shared row" });
    const files = await createDatabase({});
    const project = await createDatabase({});
    const filesPropertyId = nextId("files_kind");
    const projectPropertyId = nextId("project_status");

    await db.insert(schema.contentDatabaseItems).values([
      {
        id: nextId("item"),
        ownerEmail: OWNER,
        databaseId: files.databaseId,
        documentId: rowDocumentId,
        position: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: nextId("item"),
        ownerEmail: OWNER,
        databaseId: project.databaseId,
        documentId: rowDocumentId,
        position: 0,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.insert(schema.documentPropertyDefinitions).values([
      {
        id: filesPropertyId,
        ownerEmail: OWNER,
        databaseId: files.databaseId,
        name: "Kind",
        type: "select",
        optionsJson: JSON.stringify({
          options: [{ id: "page", name: "Page", color: "gray" }],
        }),
        position: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: projectPropertyId,
        ownerEmail: OWNER,
        databaseId: project.databaseId,
        name: "Status",
        type: "select",
        optionsJson: JSON.stringify({
          options: [{ id: "progress", name: "In progress", color: "blue" }],
        }),
        position: 0,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const [filesResult, projectResult] = await runWithRequestContext(
      { userEmail: OWNER },
      () =>
        Promise.all([
          listDocumentPropertiesAction.run({
            documentId: rowDocumentId,
            databaseId: files.databaseId,
          }),
          listDocumentPropertiesAction.run({
            documentId: rowDocumentId,
            databaseId: project.databaseId,
          }),
        ]),
    );

    expect(
      filesResult.properties.map((property) => property.definition.name),
    ).toEqual(["Kind"]);
    expect(
      projectResult.properties.map((property) => property.definition.name),
    ).toEqual(["Status"]);

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        configureDocumentPropertyAction.run({
          id: projectPropertyId,
          documentId: rowDocumentId,
          databaseId: files.databaseId,
          name: "Wrong database rename",
          type: "select",
        }),
      ),
    ).rejects.toThrow(`Property "${projectPropertyId}" not found`);
    const [unchangedProjectProperty] = await db
      .select({ name: schema.documentPropertyDefinitions.name })
      .from(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.id, projectPropertyId));
    expect(unchangedProjectProperty?.name).toBe("Status");

    await runWithRequestContext({ userEmail: OWNER }, () =>
      configureDocumentPropertyAction.run({
        documentId: rowDocumentId,
        databaseId: project.databaseId,
        name: "Priority",
        type: "select",
        options: {
          options: [{ id: "high", name: "High", color: "red" }],
        },
      }),
    );

    const definitions = await db
      .select({
        databaseId: schema.documentPropertyDefinitions.databaseId,
        name: schema.documentPropertyDefinitions.name,
      })
      .from(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.name, "Priority"));
    expect(definitions).toEqual([
      { databaseId: project.databaseId, name: "Priority" },
    ]);

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        listDocumentPropertiesAction.run({
          documentId: rowDocumentId,
          databaseId: nextId("forged_database"),
        }),
      ),
    ).rejects.toThrow(/not found/);

    const inaccessible = await createDatabase({ ownerEmail: COLLABORATOR });
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        listDocumentPropertiesAction.run({
          documentId: rowDocumentId,
          databaseId: inaccessible.databaseId,
        }),
      ),
    ).rejects.toThrow();
  });

  it("keeps the requested membership separate from Page body hydration", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const rowDocumentId = await createDocument({
      title: "Shared local and Builder row",
    });
    const local = await createDatabase({});
    const builder = await createDatabase({});
    const localItemId = nextId("local_item");
    const builderItemId = nextId("builder_item");
    const builderSourceId = nextId("builder_source");

    await db.insert(schema.contentDatabaseItems).values([
      {
        id: localItemId,
        ownerEmail: OWNER,
        databaseId: local.databaseId,
        documentId: rowDocumentId,
        position: 0,
        bodyHydrationStatus: "hydrated",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: builderItemId,
        ownerEmail: OWNER,
        databaseId: builder.databaseId,
        documentId: rowDocumentId,
        position: 0,
        bodyHydrationStatus: "complete" as any,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.insert(schema.contentDatabaseSources).values({
      id: builderSourceId,
      ownerEmail: OWNER,
      databaseId: builder.databaseId,
      sourceType: "builder-cms",
      sourceName: "Builder",
      sourceTable: "example-model",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentDatabaseSourceRows).values({
      id: nextId("source_row"),
      ownerEmail: OWNER,
      sourceId: builderSourceId,
      databaseItemId: builderItemId,
      documentId: rowDocumentId,
      sourceRowId: "example-row",
      sourceQualifiedId: "example-model:example-row",
      sourceDisplayKey: "Example row",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentDatabaseBodyHydrationQueue).values({
      id: nextId("builder_body_queue"),
      ownerEmail: OWNER,
      sourceId: builderSourceId,
      databaseItemId: builderItemId,
      documentId: rowDocumentId,
      sourceRowId: "example-row",
      sourceTable: "example-model",
      sourceEntryJson: "{}",
      createdAt: now,
      updatedAt: now,
    });

    const [localResult, builderResult, contextFreeResult] =
      await runWithRequestContext({ userEmail: OWNER }, () =>
        Promise.all([
          getDocumentAction.run({
            id: rowDocumentId,
            databaseId: local.databaseId,
            databaseDocumentId: local.databaseDocumentId,
          }),
          getDocumentAction.run({
            id: rowDocumentId,
            databaseId: builder.databaseId,
            databaseDocumentId: builder.databaseDocumentId,
          }),
          getDocumentAction.run({ id: rowDocumentId }),
        ]),
      );

    expect(localResult.databaseMembership).toMatchObject({
      databaseId: local.databaseId,
      sourceId: null,
    });
    expect(localResult.contextPath).toEqual([
      expect.objectContaining({ id: local.databaseId, kind: "database" }),
    ]);
    expect(localResult.bodyHydration).toMatchObject({
      provider: "builder",
      sourceId: builderSourceId,
      databaseDocumentId: builder.databaseDocumentId,
      hydration: { status: "pending" },
    });
    expect(builderResult.databaseMembership).toMatchObject({
      databaseId: builder.databaseId,
      sourceId: builderSourceId,
    });
    expect(builderResult.contextPath).toEqual([
      expect.objectContaining({ id: builder.databaseId, kind: "database" }),
    ]);
    expect(contextFreeResult.databaseMembership).toMatchObject({
      databaseId: builder.databaseId,
    });

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        getDocumentAction.run({
          id: rowDocumentId,
          databaseId: local.databaseId,
          databaseDocumentId: builder.databaseDocumentId,
        }),
      ),
    ).rejects.toThrow("Database context not found");
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        getDocumentAction.run({
          id: rowDocumentId,
          databaseId: nextId("forged_database"),
        }),
      ),
    ).rejects.toThrow("Database context not found");
  });

  it("does not invent Builder hydration for a local-only Page", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const rowDocumentId = await createDocument({ title: "Local-only row" });
    const local = await createDatabase({});
    await db.insert(schema.contentDatabaseItems).values({
      id: nextId("local_only_item"),
      ownerEmail: OWNER,
      databaseId: local.databaseId,
      documentId: rowDocumentId,
      position: 0,
      bodyHydrationStatus: "hydrated",
      createdAt: now,
      updatedAt: now,
    });

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      getDocumentAction.run({
        id: rowDocumentId,
        databaseId: local.databaseId,
        databaseDocumentId: local.databaseDocumentId,
      }),
    );

    expect(result.databaseMembership?.databaseId).toBe(local.databaseId);
    expect(result.bodyHydration).toBeUndefined();
  });

  it("gates hidden or viewer-only source hydration without leaking a pump target", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const rowDocumentId = await createDocument({ title: "Shared row" });
    const local = await createDatabase({});
    const hiddenBuilder = await createDatabase({ ownerEmail: COLLABORATOR });
    const hiddenItemId = nextId("hidden_builder_item");
    const hiddenBuilderSourceId = nextId("hidden_builder_source");
    await db.insert(schema.contentDatabaseItems).values([
      {
        id: nextId("visible_local_item"),
        ownerEmail: OWNER,
        databaseId: local.databaseId,
        documentId: rowDocumentId,
        position: 0,
        bodyHydrationStatus: "hydrated",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: hiddenItemId,
        ownerEmail: COLLABORATOR,
        databaseId: hiddenBuilder.databaseId,
        documentId: rowDocumentId,
        position: 0,
        bodyHydrationStatus: "pending",
        bodyHydrationAttemptedAt: now,
        bodyHydrationError: "Private Builder diagnostic",
        bodyHydrationVersion: "private-builder-version",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.insert(schema.contentDatabaseSources).values({
      id: hiddenBuilderSourceId,
      ownerEmail: COLLABORATOR,
      databaseId: hiddenBuilder.databaseId,
      sourceType: "builder-cms",
      sourceName: "Builder",
      sourceTable: "hidden-model",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentDatabaseSourceRows).values({
      id: nextId("hidden_source_row"),
      ownerEmail: COLLABORATOR,
      sourceId: hiddenBuilderSourceId,
      databaseItemId: hiddenItemId,
      documentId: rowDocumentId,
      sourceRowId: "hidden-row",
      sourceQualifiedId: "hidden-model:hidden-row",
      sourceDisplayKey: "Hidden row",
      createdAt: now,
      updatedAt: now,
    });

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      getDocumentAction.run({
        id: rowDocumentId,
        databaseId: local.databaseId,
        databaseDocumentId: local.databaseDocumentId,
      }),
    );

    expect(result.databaseMembership?.databaseId).toBe(local.databaseId);
    expect(result.bodyHydration).toEqual({
      hydration: {
        status: "pending",
        attemptedAt: null,
        error: null,
        version: null,
      },
    });
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        getDocumentAction.run({
          id: rowDocumentId,
          databaseId: hiddenBuilder.databaseId,
          databaseDocumentId: hiddenBuilder.databaseDocumentId,
        }),
      ),
    ).rejects.toThrow();

    await db.insert(schema.documentShares).values({
      id: nextId("share"),
      resourceId: hiddenBuilder.databaseDocumentId,
      principalType: "user",
      principalId: OWNER,
      role: "viewer",
      createdBy: COLLABORATOR,
      createdAt: now,
    });
    const viewerResult = await runWithRequestContext({ userEmail: OWNER }, () =>
      getDocumentAction.run({
        id: rowDocumentId,
        databaseId: local.databaseId,
        databaseDocumentId: local.databaseDocumentId,
      }),
    );
    expect(viewerResult.canEdit).toBe(true);
    expect(viewerResult.bodyHydration).toEqual({
      hydration: {
        status: "pending",
        attemptedAt: now,
        error: "Private Builder diagnostic",
        version: "private-builder-version",
      },
    });
  });

  it("does not gate a Page for a non-Builder source membership", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const rowDocumentId = await createDocument({ title: "Notion row" });
    const notion = await createDatabase({});
    const itemId = nextId("notion_item");
    const sourceId = nextId("notion_source");
    await db.insert(schema.contentDatabaseItems).values({
      id: itemId,
      ownerEmail: OWNER,
      databaseId: notion.databaseId,
      documentId: rowDocumentId,
      position: 0,
      bodyHydrationStatus: "pending",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentDatabaseSources).values({
      id: sourceId,
      ownerEmail: OWNER,
      databaseId: notion.databaseId,
      sourceType: "notion-database",
      sourceName: "Notion",
      sourceTable: "example-database",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentDatabaseSourceRows).values({
      id: nextId("notion_source_row"),
      ownerEmail: OWNER,
      sourceId,
      databaseItemId: itemId,
      documentId: rowDocumentId,
      sourceRowId: "notion-row",
      sourceQualifiedId: "notion:example-database:notion-row",
      sourceDisplayKey: "Notion row",
      createdAt: now,
      updatedAt: now,
    });

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      getDocumentAction.run({ id: rowDocumentId }),
    );

    expect(result.bodyHydration).toBeUndefined();
  });

  it("does not expose a Builder pump target when the queue source is stale", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const rowDocumentId = await createDocument({ title: "Stale queue row" });
    const builder = await createDatabase({});
    const itemId = nextId("stale_queue_item");
    const sourceId = nextId("current_builder_source");
    await db.insert(schema.contentDatabaseItems).values({
      id: itemId,
      ownerEmail: OWNER,
      databaseId: builder.databaseId,
      documentId: rowDocumentId,
      position: 0,
      bodyHydrationStatus: "pending",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentDatabaseSources).values({
      id: sourceId,
      ownerEmail: OWNER,
      databaseId: builder.databaseId,
      sourceType: "builder-cms",
      sourceName: "Builder",
      sourceTable: "example-model",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentDatabaseSourceRows).values({
      id: nextId("current_builder_source_row"),
      ownerEmail: OWNER,
      sourceId,
      databaseItemId: itemId,
      documentId: rowDocumentId,
      sourceRowId: "current-row",
      sourceQualifiedId: "example-model:current-row",
      sourceDisplayKey: "Current row",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentDatabaseBodyHydrationQueue).values({
      id: nextId("stale_queue"),
      ownerEmail: OWNER,
      sourceId,
      databaseItemId: itemId,
      documentId: rowDocumentId,
      sourceRowId: "stale-row",
      sourceTable: "example-model",
      sourceEntryJson: "{}",
      createdAt: now,
      updatedAt: now,
    });

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      getDocumentAction.run({ id: rowDocumentId }),
    );

    expect(result.bodyHydration).toBeUndefined();
  });

  it("gates ambiguously sourced Builder hydration without choosing a pump target", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const rowDocumentId = await createDocument({ title: "Ambiguous row" });
    const first = await createDatabase({});
    const second = await createDatabase({});
    for (const [index, database] of [first, second].entries()) {
      const itemId = nextId(`ambiguous_item_${index}`);
      const sourceId = nextId(`ambiguous_source_${index}`);
      await db.insert(schema.contentDatabaseItems).values({
        id: itemId,
        ownerEmail: OWNER,
        databaseId: database.databaseId,
        documentId: rowDocumentId,
        position: 0,
        bodyHydrationStatus: "pending",
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(schema.contentDatabaseSources).values({
        id: sourceId,
        ownerEmail: OWNER,
        databaseId: database.databaseId,
        sourceType: "builder-cms",
        sourceName: `Builder ${index}`,
        sourceTable: `model-${index}`,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(schema.contentDatabaseSourceRows).values({
        id: nextId(`ambiguous_source_row_${index}`),
        ownerEmail: OWNER,
        sourceId,
        databaseItemId: itemId,
        documentId: rowDocumentId,
        sourceRowId: `row-${index}`,
        sourceQualifiedId: `model-${index}:row-${index}`,
        sourceDisplayKey: `Row ${index}`,
        createdAt: now,
        updatedAt: now,
      });
    }

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      getDocumentAction.run({ id: rowDocumentId }),
    );

    expect(result.bodyHydration).toEqual({
      hydration: expect.objectContaining({ status: "pending" }),
    });
  });
});

describe("document trash lifecycle", () => {
  it("round-trips a page subtree without changing ids, bodies, or hierarchy", async () => {
    const rootId = await createDocument({
      title: "Trash root",
      content: "Root body",
    });
    const childId = await createDocument({
      parentId: rootId,
      title: "Trash child",
      content: "Child body",
    });

    const deleted = await runWithRequestContext({ userEmail: OWNER }, () =>
      deleteDocumentAction.run({ id: rootId }),
    );
    expect(deleted.deleted).toBe(2);
    expect(await documentRow(rootId)).toMatchObject({
      content: "Root body",
      trashedAt: expect.any(String),
      trashRootId: rootId,
    });
    expect(await documentRow(childId)).toMatchObject({
      parentId: rootId,
      content: "Child body",
      trashedAt: expect.any(String),
      trashRootId: rootId,
    });

    const active = await runWithRequestContext({ userEmail: OWNER }, () =>
      listDocumentsAction.run({}),
    );
    expect(active.documents.map((document) => document.id)).not.toContain(
      rootId,
    );
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        getDocumentAction.run({ id: rootId }),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });

    const trash = await runWithRequestContext({ userEmail: OWNER }, () =>
      listTrashedDocumentsAction.run({}),
    );
    expect(trash.documents).toContainEqual(
      expect.objectContaining({ documentId: rootId, title: "Trash root" }),
    );
    expect(
      trash.documents.map((document) => document.documentId),
    ).not.toContain(childId);

    const restored = await runWithRequestContext({ userEmail: OWNER }, () =>
      restoreDocumentAction.run({ id: rootId }),
    );
    expect(restored.restored).toBe(2);
    expect(await documentRow(rootId)).toMatchObject({
      content: "Root body",
      trashedAt: null,
      trashRootId: null,
    });
    expect(await documentRow(childId)).toMatchObject({
      parentId: rootId,
      content: "Child body",
      trashedAt: null,
      trashRootId: null,
    });
  });

  it("does not restore a child that was trashed separately before its parent", async () => {
    const rootId = await createDocument({ title: "Later parent" });
    const childId = await createDocument({
      parentId: rootId,
      title: "Earlier child",
    });

    await runWithRequestContext({ userEmail: OWNER }, () =>
      deleteDocumentAction.run({ id: childId }),
    );
    await runWithRequestContext({ userEmail: OWNER }, () =>
      deleteDocumentAction.run({ id: rootId }),
    );
    await runWithRequestContext({ userEmail: OWNER }, () =>
      restoreDocumentAction.run({ id: rootId }),
    );

    expect(await documentRow(rootId)).toMatchObject({ trashedAt: null });
    expect(await documentRow(childId)).toMatchObject({
      trashedAt: expect.any(String),
      trashRootId: childId,
    });
  });

  it("does not restore a database that was already in Trash before its parent", async () => {
    const rootId = await createDocument({
      title: "Parent of trashed database",
    });
    const databaseDeletedAt = "2026-07-19T12:00:00.000Z";
    const { databaseId, databaseDocumentId } = await createDatabase({
      backingParentId: rootId,
      deletedAt: databaseDeletedAt,
    });

    await runWithRequestContext({ userEmail: OWNER }, () =>
      deleteDocumentAction.run({ id: rootId }),
    );
    await runWithRequestContext({ userEmail: OWNER }, () =>
      restoreDocumentAction.run({ id: rootId }),
    );

    expect(await databaseRow(databaseId)).toMatchObject({
      deletedAt: databaseDeletedAt,
    });
    expect(await documentRow(databaseDocumentId)).toMatchObject({
      trashedAt: null,
      trashRootId: null,
    });
  });

  it("requires Trash before permanent deletion", async () => {
    const documentId = await createDocument({ title: "Purge me" });
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        permanentlyDeleteDocumentAction.run({ id: documentId }),
      ),
    ).rejects.toThrow("must be in Trash");

    await runWithRequestContext({ userEmail: OWNER }, () =>
      deleteDocumentAction.run({ id: documentId }),
    );
    await runWithRequestContext({ userEmail: OWNER }, () =>
      permanentlyDeleteDocumentAction.run({ id: documentId }),
    );
    expect(await documentRow(documentId)).toBeUndefined();
  });

  it("permanently deletes only a selected Trash root", async () => {
    const rootId = await createDocument({ title: "Trash root" });
    const childId = await createDocument({
      parentId: rootId,
      title: "Trash child",
    });
    await runWithRequestContext({ userEmail: OWNER }, () =>
      deleteDocumentAction.run({ id: rootId }),
    );

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        permanentlyDeleteDocumentAction.run({ id: childId }),
      ),
    ).rejects.toThrow("Trash root");
    expect(await documentRow(rootId)).toBeDefined();
    expect(await documentRow(childId)).toBeDefined();
  });

  it("preserves an independently trashed descendant when deleting its parent root", async () => {
    const rootId = await createDocument({ title: "Later root" });
    const childId = await createDocument({
      parentId: rootId,
      title: "Earlier root",
    });
    await runWithRequestContext({ userEmail: OWNER }, () =>
      deleteDocumentAction.run({ id: childId }),
    );
    await runWithRequestContext({ userEmail: OWNER }, () =>
      deleteDocumentAction.run({ id: rootId }),
    );
    await runWithRequestContext({ userEmail: OWNER }, () =>
      permanentlyDeleteDocumentAction.run({ id: rootId }),
    );

    expect(await documentRow(rootId)).toBeUndefined();
    expect(await documentRow(childId)).toMatchObject({
      parentId: null,
      trashRootId: childId,
      trashedAt: expect.any(String),
    });
  });

  it("does not expose another owner's trashed page title", async () => {
    const foreignId = await createDocument({
      title: "Sensitive foreign title",
      ownerEmail: COLLABORATOR,
    });
    await runWithRequestContext({ userEmail: COLLABORATOR }, () =>
      deleteDocumentAction.run({ id: foreignId }),
    );

    const trash = await runWithRequestContext({ userEmail: OWNER }, () =>
      listTrashedDocumentsAction.run({}),
    );
    expect(
      trash.documents.map((document) => document.documentId),
    ).not.toContain(foreignId);
  });
});

describe("inline database lifecycle reconcile", () => {
  it("does not let a stale empty preview save replace a newer hydrated body", async () => {
    const documentId = await createDocument({
      title: "Builder row",
      content: "",
    });
    const loadedUpdatedAt = "2026-07-02T12:00:00.000Z";
    const hydratedUpdatedAt = "2026-07-02T12:00:02.000Z";
    const db = getDb();
    await db
      .update(schema.documents)
      .set({
        content: "Hydrated Builder body",
        updatedAt: hydratedUpdatedAt,
      })
      .where(eq(schema.documents.id, documentId));

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: documentId,
        content: "<empty-block/>",
        loadedUpdatedAt,
      }),
    );

    expect(result.content).toBe("Hydrated Builder body");
    expect((await documentRow(documentId))?.content).toBe(
      "Hydrated Builder body",
    );
  });

  it("allows an empty-body clear when the preview baseline is current", async () => {
    const updatedAt = "2026-07-02T12:00:02.000Z";
    const documentId = await createDocument({
      title: "Builder row",
      content: "Hydrated Builder body",
    });
    const db = getDb();
    await db
      .update(schema.documents)
      .set({ updatedAt })
      .where(eq(schema.documents.id, documentId));

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: documentId,
        content: "<empty-block/>",
        loadedUpdatedAt: updatedAt,
      }),
    );

    expect(result.content).toBe("<empty-block/>");
    expect((await documentRow(documentId))?.content).toBe("<empty-block/>");
  });

  it("soft-deletes an owned inline database when its owner block is removed", async () => {
    const hostDocumentId = await createDocument({ title: "Host" });
    const ownerBlockId = nextId("inline_database");
    const { databaseId, databaseDocumentId } = await createDatabase({
      hostDocumentId,
      ownerBlockId,
    });
    const originalContent = inlineDatabaseBlock({
      blockId: ownerBlockId,
      databaseId,
      databaseDocumentId,
    });
    const db = getDb();
    await db
      .update(schema.documents)
      .set({ content: originalContent })
      .where(eq(schema.documents.id, hostDocumentId));

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: hostDocumentId,
        content: "The database block was removed.",
      }),
    );

    expect(result.softDeletedDatabaseIds).toEqual([databaseId]);
    expect((await databaseRow(databaseId))?.deletedAt).toEqual(
      expect.any(String),
    );
  });

  it("does not delete when only a non-owning reference block is removed", async () => {
    const hostDocumentId = await createDocument({ title: "Host" });
    const ownerBlockId = nextId("inline_database");
    const referenceBlockId = nextId("inline_database_reference");
    const { databaseId, databaseDocumentId } = await createDatabase({
      hostDocumentId,
      ownerBlockId,
    });
    const ownerBlock = inlineDatabaseBlock({
      blockId: ownerBlockId,
      databaseId,
      databaseDocumentId,
    });
    const referenceBlock = inlineDatabaseBlock({
      blockId: referenceBlockId,
      databaseId,
      databaseDocumentId,
    });
    const db = getDb();
    await db
      .update(schema.documents)
      .set({ content: `${ownerBlock}\n${referenceBlock}` })
      .where(eq(schema.documents.id, hostDocumentId));

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: hostDocumentId,
        content: ownerBlock,
      }),
    );

    expect(result.softDeletedDatabaseIds).toEqual([]);
    expect((await databaseRow(databaseId))?.deletedAt).toBeNull();
  });

  it("does not delete when the database document is no longer positionally owned", async () => {
    const hostDocumentId = await createDocument({ title: "Host" });
    const otherParentId = await createDocument({ title: "Other" });
    const ownerBlockId = nextId("inline_database");
    const { databaseId } = await createDatabase({
      hostDocumentId,
      ownerBlockId,
      backingParentId: otherParentId,
    });

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: hostDocumentId,
        content: "No inline database block here.",
      }),
    );

    expect(result.softDeletedDatabaseIds).toEqual([]);
    expect((await databaseRow(databaseId))?.deletedAt).toBeNull();
  });

  it("clears block ownership when move-document reparents an inline database backing document", async () => {
    const hostDocumentId = await createDocument({ title: "Host A" });
    const ownerBlockId = nextId("inline_database");
    const { databaseId, databaseDocumentId } = await createDatabase({
      hostDocumentId,
      ownerBlockId,
    });
    const originalContent = inlineDatabaseBlock({
      blockId: ownerBlockId,
      databaseId,
      databaseDocumentId,
    });
    const db = getDb();
    await db
      .update(schema.documents)
      .set({ content: originalContent })
      .where(eq(schema.documents.id, hostDocumentId));

    await runWithRequestContext({ userEmail: OWNER }, () =>
      moveDocumentAction.run({
        id: databaseDocumentId,
        parentId: null,
      }),
    );

    const movedDatabase = await databaseRow(databaseId);
    expect(movedDatabase?.ownerDocumentId).toBeNull();
    expect(movedDatabase?.ownerBlockId).toBeNull();

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: hostDocumentId,
        content: "The inline reference was removed after reparenting.",
      }),
    );

    expect(result.softDeletedDatabaseIds).toEqual([]);
    expect((await databaseRow(databaseId))?.deletedAt).toBeNull();
  });

  it("skips deletion when inline database parsing is uncertain", async () => {
    const hostDocumentId = await createDocument({ title: "Host" });
    const ownerBlockId = nextId("inline_database");
    const { databaseId } = await createDatabase({
      hostDocumentId,
      ownerBlockId,
    });

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: hostDocumentId,
        content: '<InlineDatabase id="broken"',
      }),
    );

    expect(result.softDeletedDatabaseIds).toEqual([]);
    expect((await databaseRow(databaseId))?.deletedAt).toBeNull();
  });
});

describe("content database soft-delete actions and reads", () => {
  it("delete-content-database and restore-content-database round-trip deleted_at", async () => {
    const { databaseId, databaseDocumentId } = await createDatabase({});

    const deleted = await runWithRequestContext({ userEmail: OWNER }, () =>
      deleteContentDatabaseAction.run({ databaseId }),
    );
    expect(deleted.documentId).toBe(databaseDocumentId);
    expect(deleted.deletedAt).toEqual(expect.any(String));
    expect((await databaseRow(databaseId))?.deletedAt).toEqual(
      deleted.deletedAt,
    );

    const restored = await runWithRequestContext({ userEmail: OWNER }, () =>
      restoreContentDatabaseAction.run({ databaseId }),
    );
    expect(restored.documentId).toBe(databaseDocumentId);
    expect(restored.deletedAt).toBeNull();
    expect((await databaseRow(databaseId))?.deletedAt).toBeNull();
  });

  it("clears stale inline ownership when restoring after the owner block is gone", async () => {
    const hostDocumentId = await createDocument({
      title: "Host",
      content: "The inline block is gone.",
    });
    const ownerBlockId = nextId("inline_database");
    const { databaseId } = await createDatabase({
      hostDocumentId,
      ownerBlockId,
      deletedAt: new Date().toISOString(),
    });

    await runWithRequestContext({ userEmail: OWNER }, () =>
      restoreContentDatabaseAction.run({ databaseId }),
    );

    const restored = await databaseRow(databaseId);
    expect(restored?.deletedAt).toBeNull();
    expect(restored?.ownerDocumentId).toBeNull();
    expect(restored?.ownerBlockId).toBeNull();
  });

  it("excludes soft-deleted databases from get-content-database and list-documents", async () => {
    const hostDocumentId = await createDocument({ title: "Host" });
    const { databaseId, databaseDocumentId } = await createDatabase({
      hostDocumentId,
      ownerBlockId: nextId("inline_database"),
      deletedAt: new Date().toISOString(),
    });
    const rowDocumentId = await createDocument({
      parentId: databaseDocumentId,
      title: "Row",
    });
    const db = getDb();
    await db.insert(schema.contentDatabaseItems).values({
      id: nextId("item"),
      ownerEmail: OWNER,
      databaseId,
      documentId: rowDocumentId,
      position: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const databaseResponse = await runWithRequestContext(
      { userEmail: OWNER },
      () => getContentDatabaseAction.run({ databaseId }),
    );
    expect(databaseResponse).toMatchObject({
      available: false,
      reason: "deleted",
      databaseId,
    });
    const pageResponse = await runWithRequestContext({ userEmail: OWNER }, () =>
      queryContentDatabaseItemsAction.run({ databaseId }),
    );
    expect(pageResponse).toMatchObject({
      available: false,
      reason: "deleted",
      databaseId,
    });

    const listResponse = await runWithRequestContext({ userEmail: OWNER }, () =>
      listDocumentsAction.run({}),
    );
    const listedIds = new Set(listResponse.documents.map((doc) => doc.id));
    expect(listedIds.has(hostDocumentId)).toBe(true);
    expect(listedIds.has(databaseDocumentId)).toBe(false);
    expect(listedIds.has(rowDocumentId)).toBe(false);
  });

  it("returns only the ordered, filtered database page and preserves read access", async () => {
    const { databaseId, databaseDocumentId } = await createDatabase({});
    const db = getDb();
    const now = new Date().toISOString();
    const rows = await Promise.all(
      [
        { title: "Zebra", position: 0 },
        { title: "Apricot", position: 1 },
        { title: "Banana", position: 2 },
      ].map(async ({ title, position }) => {
        const documentId = await createDocument({
          parentId: databaseDocumentId,
          title,
        });
        const id = nextId("item");
        await db.insert(schema.contentDatabaseItems).values({
          id,
          ownerEmail: OWNER,
          databaseId,
          documentId,
          position,
          createdAt: now,
          updatedAt: now,
        });
        return { id, documentId };
      }),
    );

    const response = await runWithRequestContext({ userEmail: OWNER }, () =>
      queryContentDatabaseItemsAction.run({
        databaseId,
        limit: 1,
        offset: 1,
        tableQuery: {
          search: "a",
          filters: [],
          sorts: [{ key: "name", label: "Name", direction: "asc" }],
          filterMode: "and",
        },
      }),
    );
    expect(response).toMatchObject({
      tableQueryMode: "server",
      pagination: {
        offset: 1,
        limit: 1,
        totalItems: 3,
        returnedItems: 1,
        hasMore: true,
      },
    });
    expect(response.items.map((item) => item.document.title)).toEqual([
      "Banana",
    ]);
    expect(response).not.toHaveProperty("database");
    expect(response).not.toHaveProperty("contextPath");
    expect(response).not.toHaveProperty("properties");
    expect(response.items[0].id).toBe(rows[2].id);

    await expect(
      runWithRequestContext({ userEmail: COLLABORATOR }, () =>
        queryContentDatabaseItemsAction.run({ databaseId }),
      ),
    ).rejects.toThrow(`Database "${databaseId}" not found`);
  });

  it("keeps a 584-row Date sort page-bounded before document and property hydration", async () => {
    const { databaseId, databaseDocumentId } = await createDatabase({});
    const db = getDb();
    const now = new Date().toISOString();
    const datePropertyId = nextId("date_property");
    await db.insert(schema.documentPropertyDefinitions).values({
      id: datePropertyId,
      ownerEmail: OWNER,
      databaseId,
      name: "Date",
      type: "date",
      visibility: "always_show",
      optionsJson: "{}",
      position: 0,
      createdAt: now,
      updatedAt: now,
    });

    const rows = Array.from({ length: 584 }, (_, index) => {
      const documentId = nextId("date_row_doc");
      return {
        documentId,
        itemId: nextId("date_row_item"),
        valueId: nextId("date_row_value"),
        index,
        date: new Date(Date.UTC(2024, 0, 1) + index * 86_400_000)
          .toISOString()
          .slice(0, 10),
      };
    });
    await db.insert(schema.documents).values(
      rows.map((row) => ({
        id: row.documentId,
        ownerEmail: OWNER,
        parentId: databaseDocumentId,
        title: `Dated row ${row.index}`,
        content: "",
        position: row.index,
        visibility: "private" as const,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db.insert(schema.contentDatabaseItems).values(
      rows.map((row) => ({
        id: row.itemId,
        ownerEmail: OWNER,
        databaseId,
        documentId: row.documentId,
        position: row.index,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db.insert(schema.documentPropertyValues).values(
      rows.map((row) => ({
        id: row.valueId,
        ownerEmail: OWNER,
        documentId: row.documentId,
        propertyId: datePropertyId,
        valueJson: JSON.stringify({ start: row.date, includeTime: false }),
        createdAt: now,
        updatedAt: now,
      })),
    );

    const tableQuery = {
      search: "",
      filters: [],
      sorts: [
        {
          key: datePropertyId,
          label: "Date",
          direction: "desc" as const,
        },
      ],
      filterMode: "and" as const,
    };
    const startedAt = performance.now();
    const response = await runWithRequestContext({ userEmail: OWNER }, () =>
      queryContentDatabaseItemsAction.run({
        databaseId,
        limit: 1,
        offset: 100,
        tableQuery,
      }),
    );
    const durationMs = performance.now() - startedAt;

    expect(response.items.map((item) => item.document.title)).toEqual([
      "Dated row 483",
    ]);
    expect(response.pagination).toEqual({
      offset: 100,
      limit: 1,
      totalItems: 584,
      returnedItems: 1,
      hasMore: true,
    });
    expect(durationMs).toBeLessThan(1_000);

    const { getContentDatabasePageResponse } =
      await import("./_database-utils.js");
    const page = await runWithRequestContext({ userEmail: OWNER }, () =>
      getContentDatabasePageResponse(databaseId, {
        limit: 1,
        offset: 100,
        tableQuery,
        includeSources: false,
      }),
    );
    expect(page.hydratedItemCount).toBe(1);
  });

  it("blocks direct document and property reads for soft-deleted database pages", async () => {
    const deletedAt = new Date().toISOString();
    const { databaseId, databaseDocumentId } = await createDatabase({
      deletedAt,
    });
    const rowDocumentId = await createDocument({
      parentId: databaseDocumentId,
      title: "Row",
    });
    const db = getDb();
    await db.insert(schema.contentDatabaseItems).values({
      id: nextId("item"),
      ownerEmail: OWNER,
      databaseId,
      documentId: rowDocumentId,
      position: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        getDocumentAction.run({ id: databaseDocumentId }),
      ),
    ).rejects.toThrow(`Document "${databaseDocumentId}" not found`);
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        getDocumentAction.run({ id: rowDocumentId }),
      ),
    ).rejects.toThrow(`Document "${rowDocumentId}" not found`);
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        pullDocumentAction.run({ id: rowDocumentId, format: "markdown" }),
      ),
    ).rejects.toThrow(`Document "${rowDocumentId}" not found`);
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        listDocumentPropertiesAction.run({
          documentId: rowDocumentId,
          databaseId,
        }),
      ),
    ).rejects.toThrow(`Document "${rowDocumentId}" not found`);
  });

  it("rejects restoring a database whose page belongs to another Trash root", async () => {
    const rootId = await createDocument({ title: "Parent Trash root" });
    const { databaseId, databaseDocumentId } = await createDatabase({
      backingParentId: rootId,
    });
    await runWithRequestContext({ userEmail: OWNER }, () =>
      deleteDocumentAction.run({ id: rootId }),
    );

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        restoreContentDatabaseAction.run({ databaseId }),
      ),
    ).rejects.toThrow("Restore the parent Trash item instead");
    expect(await databaseRow(databaseId)).toMatchObject({
      deletedAt: expect.any(String),
    });
    expect(await documentRow(databaseDocumentId)).toMatchObject({
      trashRootId: rootId,
      trashedAt: expect.any(String),
    });
  });

  it("requires backing-page admin access before deleting an inline database", async () => {
    const hostDocumentId = await createDocument({ title: "Shared host" });
    const { databaseId, databaseDocumentId } = await createDatabase({
      hostDocumentId,
      ownerBlockId: nextId("inline_database"),
    });
    const db = getDb();
    await db.insert(schema.documentShares).values({
      id: nextId("share"),
      resourceId: hostDocumentId,
      principalType: "user",
      principalId: COLLABORATOR,
      role: "editor",
      createdBy: OWNER,
      createdAt: new Date().toISOString(),
    });
    await db.insert(schema.documentShares).values({
      id: nextId("share"),
      resourceId: databaseDocumentId,
      principalType: "user",
      principalId: COLLABORATOR,
      role: "editor",
      createdBy: OWNER,
      createdAt: new Date().toISOString(),
    });

    await expect(
      runWithRequestContext({ userEmail: COLLABORATOR }, () =>
        deleteContentDatabaseAction.run({ databaseId }),
      ),
    ).rejects.toThrow(`Requires admin role on document ${databaseDocumentId}`);
    expect(await documentRow(databaseDocumentId)).toMatchObject({
      trashedAt: null,
    });
    expect(await databaseRow(databaseId)).toMatchObject({ deletedAt: null });
  });

  it("blocks row mutations for soft-deleted databases", async () => {
    const { databaseId } = await createDatabase({
      deletedAt: new Date().toISOString(),
    });

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        addDatabaseItemAction.run({ databaseId, title: "Should not write" }),
      ),
    ).rejects.toThrow(`Database "${databaseId}" not found`);

    const db = getDb();
    const rows = await db
      .select()
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, databaseId));
    expect(rows).toEqual([]);
  });

  it("lists only accessible soft-deleted databases for Trash", async () => {
    const deletedAt = new Date().toISOString();
    const ownedDeleted = await createDatabase({
      deletedAt,
    });
    const active = await createDatabase({});
    const otherDeleted = await createDatabase({
      deletedAt,
      ownerEmail: "other@example.com",
    });
    const inlineHost = await createDocument({
      title: "Inline Host",
      content: "Inline block has already been deleted.",
    });
    const inlineOwnedDeleted = await createDatabase({
      hostDocumentId: inlineHost,
      ownerBlockId: nextId("inline_database"),
      deletedAt,
    });
    const db = getDb();
    await db.insert(schema.documentShares).values({
      id: nextId("share"),
      resourceId: inlineOwnedDeleted.databaseDocumentId,
      principalType: "user",
      principalId: COLLABORATOR,
      role: "editor",
      createdBy: OWNER,
      createdAt: new Date().toISOString(),
    });

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      listTrashedContentDatabasesAction.run({}),
    );

    expect(result.databases).toEqual(
      expect.arrayContaining([
        {
          databaseId: ownedDeleted.databaseId,
          title: "Database",
          documentId: ownedDeleted.databaseDocumentId,
          ownerDocumentId: null,
          deletedAt,
          canPermanentlyDelete: false,
        },
      ]),
    );
    const listedIds = new Set(
      result.databases.map((database) => database.databaseId),
    );
    expect(listedIds.has(active.databaseId)).toBe(false);
    expect(listedIds.has(otherDeleted.databaseId)).toBe(false);

    const collaboratorResult = await runWithRequestContext(
      { userEmail: COLLABORATOR },
      () => listTrashedContentDatabasesAction.run({}),
    );
    expect(
      collaboratorResult.databases.some(
        (database) => database.databaseId === inlineOwnedDeleted.databaseId,
      ),
    ).toBe(false);

    await db.insert(schema.documentShares).values({
      id: nextId("share"),
      resourceId: inlineHost,
      principalType: "user",
      principalId: COLLABORATOR,
      role: "editor",
      createdBy: OWNER,
      createdAt: new Date().toISOString(),
    });
    const hostEditorResult = await runWithRequestContext(
      { userEmail: COLLABORATOR },
      () => listTrashedContentDatabasesAction.run({}),
    );
    expect(hostEditorResult.databases).toEqual([
      expect.objectContaining({
        databaseId: inlineOwnedDeleted.databaseId,
        canPermanentlyDelete: false,
      }),
    ]);
  });

  it("requires host document edit access before detaching inline database ownership", async () => {
    const hostDocumentId = await createDocument({ title: "Host" });
    const { databaseId, databaseDocumentId } = await createDatabase({
      hostDocumentId,
      ownerBlockId: nextId("inline_database"),
    });
    const db = getDb();
    await db.insert(schema.documentShares).values({
      id: nextId("share"),
      resourceId: databaseDocumentId,
      principalType: "user",
      principalId: COLLABORATOR,
      role: "editor",
      createdBy: OWNER,
      createdAt: new Date().toISOString(),
    });

    await expect(
      runWithRequestContext({ userEmail: COLLABORATOR }, () =>
        moveDocumentAction.run({ id: databaseDocumentId, parentId: null }),
      ),
    ).rejects.toThrow(`No access to document ${hostDocumentId}`);

    const database = await databaseRow(databaseId);
    expect(database?.ownerDocumentId).toBe(hostDocumentId);
    expect(database?.ownerBlockId).toEqual(expect.any(String));
    expect((await documentRow(databaseDocumentId))?.parentId).toBe(
      hostDocumentId,
    );
  });

  it("keeps root reordering scoped to the document visibility section", async () => {
    const ownerEmail = `${nextId("owner")}@example.com`;
    const privateA = await createDocument({
      title: "Private A",
      position: 0,
      visibility: "private",
      ownerEmail,
    });
    const privateB = await createDocument({
      title: "Private B",
      position: 1,
      visibility: "private",
      ownerEmail,
    });
    const orgRoot = await createDocument({
      title: "Org Root",
      position: 0,
      visibility: "org",
      ownerEmail,
    });

    await runWithRequestContext({ userEmail: ownerEmail }, () =>
      moveDocumentAction.run({ id: privateB, parentId: null, position: 0 }),
    );

    expect((await documentRow(privateB, ownerEmail))?.position).toBe(0);
    expect((await documentRow(privateA, ownerEmail))?.position).toBe(1);
    expect((await documentRow(orgRoot, ownerEmail))?.position).toBe(0);
  });

  it("keeps root reordering scoped to the document org section", async () => {
    const ownerEmail = `${nextId("owner")}@example.com`;
    const orgA1 = await createDocument({
      title: "Org A 1",
      position: 0,
      visibility: "org",
      orgId: "org-a",
      ownerEmail,
    });
    const orgA2 = await createDocument({
      title: "Org A 2",
      position: 1,
      visibility: "org",
      orgId: "org-a",
      ownerEmail,
    });
    const orgB = await createDocument({
      title: "Org B",
      position: 0,
      visibility: "org",
      orgId: "org-b",
      ownerEmail,
    });

    await runWithRequestContext({ userEmail: ownerEmail, orgId: "org-a" }, () =>
      moveDocumentAction.run({ id: orgA2, parentId: null, position: 0 }),
    );

    expect((await documentRow(orgA2, ownerEmail))?.position).toBe(0);
    expect((await documentRow(orgA1, ownerEmail))?.position).toBe(1);
    expect((await documentRow(orgB, ownerEmail))?.position).toBe(0);
  });

  it("rejects parenting documents across visibility sections", async () => {
    const ownerEmail = `${nextId("owner")}@example.com`;
    const privateChild = await createDocument({
      title: "Private Child",
      visibility: "private",
      ownerEmail,
    });
    const orgParent = await createDocument({
      title: "Org Parent",
      visibility: "org",
      ownerEmail,
    });

    await expect(
      runWithRequestContext({ userEmail: ownerEmail }, () =>
        moveDocumentAction.run({ id: privateChild, parentId: orgParent }),
      ),
    ).rejects.toThrow("Parent document must be in the same section");

    expect((await documentRow(privateChild, ownerEmail))?.parentId).toBeNull();
  });

  it("rejects parenting documents across org sections", async () => {
    const ownerEmail = `${nextId("owner")}@example.com`;
    const orgAChild = await createDocument({
      title: "Org A Child",
      visibility: "org",
      orgId: "org-a",
      ownerEmail,
    });
    const orgBParent = await createDocument({
      title: "Org B Parent",
      visibility: "org",
      orgId: "org-b",
      ownerEmail,
    });
    const db = getDb();
    await db.insert(schema.documentShares).values({
      id: nextId("share"),
      resourceId: orgBParent,
      principalType: "user",
      principalId: ownerEmail,
      role: "editor",
      createdBy: ownerEmail,
      createdAt: new Date().toISOString(),
    });

    await expect(
      runWithRequestContext({ userEmail: ownerEmail, orgId: "org-a" }, () =>
        moveDocumentAction.run({ id: orgAChild, parentId: orgBParent }),
      ),
    ).rejects.toThrow("Parent document must be in the same section");

    expect((await documentRow(orgAChild, ownerEmail))?.parentId).toBeNull();
  });
});
