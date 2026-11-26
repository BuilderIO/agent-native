import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  BUILDER_CMS_SAFE_WRITE_MODEL,
  type ExecuteBuilderSourceExecutionRequest,
} from "../shared/api";
import { builderBlocksHash } from "../shared/builder-mdx";
import type { BuilderCmsEntryLiveState } from "./_builder-cms-read-client";
import { normalizeBuilderCmsApiEntry } from "./_builder-cms-source-adapter";
import type { BuilderCmsWriteResult } from "./_builder-cms-write-client";
import { registerMemoryPrivateBlobProvider } from "./_builder-private-blob.test-fixture";
import type { ExecuteBuilderSourceExecutionDeps } from "./execute-builder-source-execution";

const TEST_DB_PATH = join(
  tmpdir(),
  `builder-article-autosave-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "owner@example.com";
const WRITER = "writer@example.com";
const SEEDED_AT = "2026-06-29T15:00:00.000Z";
const LAST_UPDATED_MS = 1782328870774;
const privateBlobs = registerMemoryPrivateBlobProvider();

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let autosave: typeof import("./_builder-article-autosave.js");
let realExecutionDeps: typeof import("./execute-builder-source-execution.js").realExecutionDeps;
let executeWithDeps: typeof import("./execute-builder-source-execution.js").executeBuilderSourceExecutionWithDeps;
let realAutosaveDeps: typeof import("./run-builder-article-autosave.js").realBuilderArticleAutosaveDeps;
let setAutosave: typeof import("./set-builder-article-autosave.js").default;
let listAutosaves: typeof import("./list-builder-article-autosaves.js").default;
let setProperty: typeof import("./set-document-property.js").default;
let configureProperty: typeof import("./configure-document-property.js").default;
let utils: typeof import("./_database-source-utils.js");

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
  autosave = await import("./_builder-article-autosave.js");
  ({
    realExecutionDeps,
    executeBuilderSourceExecutionWithDeps: executeWithDeps,
  } = await import("./execute-builder-source-execution.js"));
  ({ realBuilderArticleAutosaveDeps: realAutosaveDeps } =
    await import("./run-builder-article-autosave.js"));
  setAutosave = (await import("./set-builder-article-autosave.js")).default;
  listAutosaves = (await import("./list-builder-article-autosaves.js")).default;
  setProperty = (await import("./set-document-property.js")).default;
  configureProperty = (await import("./configure-document-property.js"))
    .default;
  utils = await import("./_database-source-utils.js");
}, 60000);

afterAll(() => {
  privateBlobs.unregister();
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

let counter = 0;

function asOwner<T>(fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ userEmail: OWNER }, fn);
}

const capabilities = JSON.stringify({
  canRefresh: true,
  canCreateChangeSets: true,
  canWriteFields: true,
  canWriteBody: true,
  canPush: true,
  canPull: true,
  canPublish: true,
  canDelete: false,
  canStageLocalRevision: true,
  liveWritesEnabled: true,
  readOnlyRefresh: true,
});

async function seedArticle(
  args: {
    linked?: boolean;
    published?: "draft" | "published";
    record?: boolean;
  } = {},
) {
  const linked = args.linked ?? true;
  const db = getDb();
  const suffix = `${++counter}_${Math.random().toString(36).slice(2, 7)}`;
  const ids = {
    databaseId: `db_${suffix}`,
    databaseDocumentId: `doc_db_${suffix}`,
    itemId: `item_${suffix}`,
    rowDocumentId: `doc_row_${suffix}`,
    sourceId: `src_${suffix}`,
    entryId: `entry_${suffix}`,
    changeSetId: `change_${suffix}`,
  };
  await db.insert(schema.documents).values([
    {
      id: ids.databaseDocumentId,
      ownerEmail: OWNER,
      title: "Articles",
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    },
    {
      id: ids.rowDocumentId,
      ownerEmail: OWNER,
      title: "New title",
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    },
  ]);
  await db.insert(schema.contentDatabases).values({
    id: ids.databaseId,
    ownerEmail: OWNER,
    documentId: ids.databaseDocumentId,
    title: "Articles",
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
  });
  await db.insert(schema.contentDatabaseItems).values({
    id: ids.itemId,
    ownerEmail: OWNER,
    databaseId: ids.databaseId,
    documentId: ids.rowDocumentId,
    position: 0,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: ids.sourceId,
    ownerEmail: OWNER,
    databaseId: ids.databaseId,
    sourceType: "builder-cms",
    sourceName: "Builder CMS",
    sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
    capabilitiesJson: capabilities,
    metadataJson: JSON.stringify({
      primaryKey: "id",
      titleField: "title",
      writeMode: "stage_only",
      pushMode: "autosave",
      liveReadConfigured: true,
    }),
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
  });
  if (linked) {
    await db.insert(schema.contentDatabaseSourceRows).values({
      id: `row_${suffix}`,
      ownerEmail: OWNER,
      sourceId: ids.sourceId,
      databaseItemId: ids.itemId,
      documentId: ids.rowDocumentId,
      sourceRowId: ids.entryId,
      sourceQualifiedId: `builder-cms://${BUILDER_CMS_SAFE_WRITE_MODEL}/${ids.entryId}`,
      sourceDisplayKey: "Old title",
      provenance: "source",
      sourceValuesJson: JSON.stringify({
        "data.title": "Old title",
        published: args.published ?? "draft",
      }),
      lastSourceUpdatedAt: String(LAST_UPDATED_MS),
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    });
    await db.insert(schema.contentDatabaseSourceChangeSets).values({
      id: ids.changeSetId,
      ownerEmail: OWNER,
      sourceId: ids.sourceId,
      databaseItemId: ids.itemId,
      documentId: ids.rowDocumentId,
      kind: "field_update",
      direction: "outbound",
      state: "pending_push",
      pushMode: "autosave",
      localOnly: 1,
      summary: "Pending local Builder CMS title change.",
      fieldChangesJson: JSON.stringify([
        {
          propertyId: null,
          propertyName: "Title",
          localFieldKey: "title",
          sourceFieldKey: "data.title",
          currentValue: "Old title",
          proposedValue: "New title",
        },
      ]),
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    });
  }
  if (linked && args.record !== false) {
    await db.insert(schema.contentDatabaseBuilderAutosaves).values({
      id: `autosave_${suffix}`,
      sourceId: ids.sourceId,
      databaseItemId: ids.itemId,
      documentId: ids.rowDocumentId,
      enabled: 1,
      state: "saved",
      savedEditAt: "2026-06-29T14:00:00.000Z",
      lastSavedAt: "2026-06-29T14:00:00.000Z",
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    });
  }
  return ids;
}

const liveDraft = (entryId: string): BuilderCmsEntryLiveState => ({
  exists: true,
  id: entryId,
  published: "draft",
  lastUpdated: LAST_UPDATED_MS,
  blocksHash: null,
  values: { "data.title": "Old title", published: "draft" },
});

function harness(args: {
  live?: BuilderCmsEntryLiveState;
  write?: BuilderCmsWriteResult;
  entryId: string;
  executionDeps?: Partial<ExecuteBuilderSourceExecutionDeps>;
}) {
  const executeWrite = vi.fn(
    async (): Promise<BuilderCmsWriteResult> =>
      args.write ?? {
        ok: true,
        status: 200,
        entryId: args.entryId,
        responseBody: {
          id: args.entryId,
          published: "draft",
          lastUpdated: LAST_UPDATED_MS + 5000,
          data: { title: "New title" },
        },
      },
  );
  const readLiveEntry = vi.fn(async () => args.live ?? liveDraft(args.entryId));
  const lookupSafeModelIntent = vi.fn(async () => ({
    count: 0,
    matchingIntentCount: 0,
    matches: [],
  }));
  const refreshSource = vi.fn(async () => ({}));
  const readBody = vi.fn(async () => ({}));
  const deps = {
    ...realAutosaveDeps(),
    execute: (request: ExecuteBuilderSourceExecutionRequest) =>
      executeWithDeps(
        request,
        {
          ...realExecutionDeps(request.sourceId, request.changeSetId),
          executeWrite,
          readLiveEntry,
          lookupSafeModelIntent,
          ...args.executionDeps,
        },
        { automatic: true },
      ),
    refreshSource,
    readBody,
  };
  return { deps, executeWrite, readBody, readLiveEntry, refreshSource };
}

async function record(sourceId: string, documentId: string) {
  const rows = await getDb()
    .select()
    .from(schema.contentDatabaseBuilderAutosaves)
    .where(eq(schema.contentDatabaseBuilderAutosaves.sourceId, sourceId));
  const row = rows.find((candidate) => candidate.documentId === documentId);
  if (!row) throw new Error("The article has no automatic save record.");
  return row;
}

async function executionStates(sourceId: string) {
  const executions = await getDb()
    .select({ state: schema.contentDatabaseSourceExecutions.state })
    .from(schema.contentDatabaseSourceExecutions)
    .where(eq(schema.contentDatabaseSourceExecutions.sourceId, sourceId));
  return executions.map((execution) => execution.state);
}

async function age(sourceId: string) {
  await getDb()
    .update(schema.contentDatabaseSourceExecutions)
    .set({ updatedAt: SEEDED_AT })
    .where(eq(schema.contentDatabaseSourceExecutions.sourceId, sourceId));
  await getDb()
    .update(schema.contentDatabaseBuilderAutosaves)
    .set({ updatedAt: SEEDED_AT })
    .where(eq(schema.contentDatabaseBuilderAutosaves.sourceId, sourceId));
}

async function addMembership(
  ids: Awaited<ReturnType<typeof seedArticle>>,
  name: string,
) {
  const db = getDb();
  const databaseId = `${name}_${ids.databaseId}`;
  await db.insert(schema.documents).values({
    id: `doc_${databaseId}`,
    ownerEmail: OWNER,
    title: name,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
  });
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: `doc_${databaseId}`,
    title: name,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
  });
  const removed = await db
    .delete(schema.contentDatabaseItems)
    .where(eq(schema.contentDatabaseItems.id, ids.itemId))
    .returning();
  const builderItem = removed.find((item) => item.id === ids.itemId);
  await db.insert(schema.contentDatabaseItems).values({
    id: `item_${databaseId}`,
    ownerEmail: OWNER,
    databaseId,
    documentId: ids.rowDocumentId,
    position: 0,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
  });
  if (!builderItem) throw new Error("The article has no Builder row.");
  await db.insert(schema.contentDatabaseItems).values(builderItem);
  return databaseId;
}

async function addBuilderField(
  ids: Awaited<ReturnType<typeof seedArticle>>,
  name: string,
  sourceFieldKey: string,
  field: {
    type?: string;
    sourceFieldType?: string;
    options?: Array<{ id: string; name: string; color: "gray" | "blue" }>;
  } = {},
) {
  const propertyId = `prop_${name}_${ids.sourceId}`;
  await getDb()
    .insert(schema.documentPropertyDefinitions)
    .values({
      id: propertyId,
      ownerEmail: OWNER,
      databaseId: ids.databaseId,
      name,
      type: field.type ?? "text",
      ...(field.options
        ? { optionsJson: JSON.stringify({ options: field.options }) }
        : {}),
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    });
  await getDb()
    .insert(schema.contentDatabaseSourceFields)
    .values({
      id: `field_${name}_${ids.sourceId}`,
      ownerEmail: OWNER,
      sourceId: ids.sourceId,
      propertyId,
      localFieldKey: propertyId,
      sourceFieldKey,
      sourceFieldLabel: name,
      sourceFieldType: field.sourceFieldType ?? field.type ?? "text",
      mappingType: "property",
      writeOwner: "source",
      readOnly: 0,
      provenance: "source field",
      freshness: "fresh",
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    });
  return propertyId;
}

async function builderHolds(values: Record<string, unknown>) {
  const ids = await seedArticle();
  await getDb()
    .delete(schema.contentDatabaseSourceChangeSets)
    .where(eq(schema.contentDatabaseSourceChangeSets.id, ids.changeSetId));
  await getDb()
    .update(schema.documents)
    .set({ title: "Old title" })
    .where(eq(schema.documents.id, ids.rowDocumentId));
  await getDb()
    .update(schema.contentDatabaseSourceRows)
    .set({
      sourceValuesJson: JSON.stringify({
        "data.title": "Old title",
        ...values,
        published: "draft",
      }),
    })
    .where(eq(schema.contentDatabaseSourceRows.sourceId, ids.sourceId));
  return ids;
}

function builderLive(
  ids: Awaited<ReturnType<typeof seedArticle>>,
  values: NonNullable<BuilderCmsEntryLiveState["values"]>,
): BuilderCmsEntryLiveState {
  return {
    ...liveDraft(ids.entryId),
    values: { "data.title": "Old title", ...values, published: "draft" },
  };
}

async function fill(
  ids: Awaited<ReturnType<typeof seedArticle>>,
  propertyId: string,
  value: unknown,
) {
  await asOwner(() =>
    setProperty.run(
      {
        databaseId: ids.databaseId,
        documentId: ids.rowDocumentId,
        propertyId,
        value,
      },
      { caller: "frontend", userEmail: OWNER },
    ),
  );
  await getDb()
    .update(schema.documentPropertyValues)
    .set({ updatedAt: SEEDED_AT })
    .where(eq(schema.documentPropertyValues.propertyId, propertyId));
}

async function listRows(rowDocumentId: string, now: string) {
  const database = await autosave.resolveArticleDatabase(rowDocumentId);
  if (!database) throw new Error("The row has no collection.");
  return autosave.listBuilderArticleRows({ database, now });
}

describe("Builder article autosave", () => {
  it("saves a draft's edits with a plain draft save and records it", async () => {
    const ids = await seedArticle();
    const { deps, executeWrite, readLiveEntry } = harness({
      entryId: ids.entryId,
    });

    const status = await asOwner(() =>
      autosave.runBuilderArticleAutosaveWithDeps(
        { documentId: ids.rowDocumentId },
        deps,
      ),
    );

    expect(readLiveEntry).toHaveBeenCalledTimes(1);
    expect(executeWrite).toHaveBeenCalledTimes(1);
    const [{ request }] = executeWrite.mock.calls[0] as unknown as [
      { request: { method: string; query?: Record<string, string> } },
    ];
    expect(request.method).toBe("PATCH");
    expect(request.query).not.toHaveProperty("autoSaveOnly");
    expect(status.autosave).toMatchObject({
      enabled: true,
      state: "saved",
      reason: null,
    });
    expect(status.builderUrl).toBe(`https://builder.io/content/${ids.entryId}`);
    const saved = await record(ids.sourceId, ids.rowDocumentId);
    expect(saved.savedEditAt).toBe(SEEDED_AT);
    expect(saved.attemptId).toBeNull();
  });

  it("saves a Builder field someone fills in Content with the draft", async () => {
    const ids = await seedArticle();
    await getDb()
      .delete(schema.contentDatabaseSourceChangeSets)
      .where(eq(schema.contentDatabaseSourceChangeSets.id, ids.changeSetId));
    await getDb()
      .update(schema.documents)
      .set({ title: "Old title" })
      .where(eq(schema.documents.id, ids.rowDocumentId));
    const handle = await addBuilderField(ids, "Handle", "data.handle");
    const { deps, executeWrite } = harness({ entryId: ids.entryId });

    await asOwner(() =>
      setProperty.run(
        {
          databaseId: ids.databaseId,
          documentId: ids.rowDocumentId,
          propertyId: handle,
          value: "draft-fields-check",
        },
        { caller: "frontend", userEmail: OWNER },
      ),
    );
    await getDb()
      .update(schema.documentPropertyValues)
      .set({ updatedAt: SEEDED_AT })
      .where(eq(schema.documentPropertyValues.propertyId, handle));
    await asOwner(() =>
      autosave.runBuilderArticleAutosaveWithDeps(
        { documentId: ids.rowDocumentId },
        deps,
      ),
    );

    expect(executeWrite).toHaveBeenCalledTimes(1);
    const [{ request }] = executeWrite.mock.calls[0] as unknown as [
      { request: { method: string; body: { data: Record<string, unknown> } } },
    ];
    expect(request.method).toBe("PATCH");
    expect(request.body.data).toMatchObject({ handle: "draft-fields-check" });
  });

  it("keeps Builder fields read-only in Content outside Builder's test model", async () => {
    const ids = await seedArticle();
    const handle = await addBuilderField(ids, "Handle", "data.handle");
    await getDb()
      .update(schema.contentDatabaseSources)
      .set({ sourceTable: "blog-article" })
      .where(eq(schema.contentDatabaseSources.id, ids.sourceId));

    await expect(
      asOwner(() =>
        setProperty.run(
          {
            databaseId: ids.databaseId,
            documentId: ids.rowDocumentId,
            propertyId: handle,
            value: "draft-fields-check",
          },
          { caller: "frontend", userEmail: OWNER },
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "PROPERTY_NOT_WRITABLE" });
  });

  it("takes one web link for a Builder image and turns down links Builder can't read", async () => {
    const ids = await seedArticle();
    const image = await addBuilderField(ids, "Image", "data.image", {
      type: "files_media",
      sourceFieldType: "file",
    });
    const write = (value: unknown) =>
      asOwner(() =>
        setProperty.run(
          {
            databaseId: ids.databaseId,
            documentId: ids.rowDocumentId,
            propertyId: image,
            value,
          },
          { caller: "frontend", userEmail: OWNER },
        ),
      );

    await expect(write(["/api/private-media/cover.png"])).rejects.toMatchObject(
      { errorCode: "INVALID_PROPERTY_VALUE" },
    );
    await expect(
      write(["https://cdn.builder.io/a.png", "https://cdn.builder.io/b.png"]),
    ).rejects.toMatchObject({ errorCode: "INVALID_PROPERTY_VALUE" });
    await write(["https://cdn.builder.io/a.png"]);
  });

  it("keeps the options of a Builder field that saves to Builder", async () => {
    const ids = await seedArticle();
    const builderTeam = { id: "author_1", name: "Builder Team", color: "gray" };
    const author = await addBuilderField(ids, "Author", "data.author", {
      type: "select",
      sourceFieldType: "reference",
      options: [builderTeam as { id: string; name: string; color: "gray" }],
    });

    await expect(
      asOwner(() =>
        configureProperty.run(
          {
            id: author,
            documentId: ids.rowDocumentId,
            name: "Author",
            type: "select",
            options: {
              options: [
                builderTeam,
                { id: "made_up", name: "Made Up", color: "blue" },
              ],
            },
          },
          { caller: "frontend", userEmail: OWNER },
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "SOURCE_OPTIONS_LOCKED" });
  });

  it("saves a field edited while an earlier change waits on the next run", async () => {
    const ids = await seedArticle();
    const handle = await addBuilderField(ids, "Handle", "data.handle");
    const { deps, executeWrite, readLiveEntry } = harness({
      entryId: ids.entryId,
    });
    await asOwner(() =>
      setProperty.run(
        {
          databaseId: ids.databaseId,
          documentId: ids.rowDocumentId,
          propertyId: handle,
          value: "draft-fields-check",
        },
        { caller: "frontend", userEmail: OWNER },
      ),
    );
    await getDb()
      .update(schema.documentPropertyValues)
      .set({ updatedAt: SEEDED_AT })
      .where(eq(schema.documentPropertyValues.propertyId, handle));

    await asOwner(() =>
      autosave.runBuilderArticleAutosaveWithDeps(
        { documentId: ids.rowDocumentId },
        deps,
      ),
    );

    expect(executeWrite).toHaveBeenCalledTimes(1);
    expect((await record(ids.sourceId, ids.rowDocumentId)).savedEditAt).toBe(
      "2026-06-29T14:00:00.000Z",
    );
    const listed = await asOwner(() =>
      listRows(ids.rowDocumentId, "2026-06-29T15:31:00.000Z"),
    );
    expect(listed.rows[0]?.autosave?.due).toBe(true);

    readLiveEntry.mockResolvedValue({
      ...liveDraft(ids.entryId),
      lastUpdated: LAST_UPDATED_MS + 5000,
      values: { "data.title": "New title", published: "draft" },
    });
    await age(ids.sourceId);
    await asOwner(() =>
      autosave.runBuilderArticleAutosaveWithDeps(
        { documentId: ids.rowDocumentId },
        deps,
      ),
    );

    expect(executeWrite).toHaveBeenCalledTimes(2);
    const [{ request }] = executeWrite.mock.calls[1] as unknown as [
      { request: { body: { data: Record<string, unknown> } } },
    ];
    expect(request.body.data).toEqual({ handle: "draft-fields-check" });
    const settled = await asOwner(() =>
      listRows(ids.rowDocumentId, "2026-06-29T15:31:00.000Z"),
    );
    expect(settled.rows[0]?.autosave?.due).toBe(false);
  });

  it("finds nothing to save once Builder holds the date picked in Content", async () => {
    const ids = await seedArticle();
    await getDb()
      .delete(schema.contentDatabaseSourceChangeSets)
      .where(eq(schema.contentDatabaseSourceChangeSets.id, ids.changeSetId));
    await getDb()
      .update(schema.documents)
      .set({ title: "Old title" })
      .where(eq(schema.documents.id, ids.rowDocumentId));
    await getDb()
      .update(schema.contentDatabaseSourceRows)
      .set({
        sourceValuesJson: JSON.stringify({
          "data.title": "Old title",
          "data.date": Date.UTC(2026, 10, 23),
          published: "draft",
        }),
      })
      .where(eq(schema.contentDatabaseSourceRows.sourceId, ids.sourceId));
    const date = await addBuilderField(ids, "Date", "data.date", {
      type: "date",
    });
    const { deps, executeWrite } = harness({ entryId: ids.entryId });
    await asOwner(() =>
      setProperty.run(
        {
          databaseId: ids.databaseId,
          documentId: ids.rowDocumentId,
          propertyId: date,
          value: { start: "2026-11-23", includeTime: false },
        },
        { caller: "frontend", userEmail: OWNER },
      ),
    );
    await getDb()
      .update(schema.documentPropertyValues)
      .set({ updatedAt: SEEDED_AT })
      .where(eq(schema.documentPropertyValues.propertyId, date));

    await asOwner(() =>
      autosave.runBuilderArticleAutosaveWithDeps(
        { documentId: ids.rowDocumentId },
        deps,
      ),
    );

    expect(executeWrite).not.toHaveBeenCalled();
  });

  it("saves a new time on a day Builder already holds, and nothing once it holds that time", async () => {
    for (const [held, expectedWrites] of [
      [Date.UTC(2026, 10, 23, 12), 1],
      [Date.UTC(2026, 10, 23, 17), 0],
    ] as const) {
      const ids = await builderHolds({ "data.date": held });
      const date = await addBuilderField(ids, "Date", "data.date", {
        type: "date",
      });
      const { deps, executeWrite } = harness({
        entryId: ids.entryId,
        live: builderLive(ids, { "data.date": held }),
      });
      await fill(ids, date, { start: "2026-11-23T17:00", includeTime: true });

      await asOwner(() =>
        autosave.runBuilderArticleAutosaveWithDeps(
          { documentId: ids.rowDocumentId },
          deps,
        ),
      );

      const sent = (
        executeWrite.mock.calls as unknown as [
          { request: { body: { data: Record<string, unknown> } } },
        ][]
      ).map(([{ request }]) => Object.keys(request.body.data));
      expect(sent).toEqual(expectedWrites ? [["date"]] : []);
    }
  });

  it("finds nothing to save once Builder holds a link in its own form", async () => {
    const ids = await builderHolds({
      "data.image": "https://cdn.builder.io/cover.png",
    });
    const image = await addBuilderField(ids, "Image", "data.image", {
      type: "files_media",
      sourceFieldType: "file",
    });
    const { deps, executeWrite } = harness({
      entryId: ids.entryId,
      live: builderLive(ids, {
        "data.image": "https://cdn.builder.io/cover.png",
      }),
    });
    await fill(ids, image, ["https://CDN.builder.io/cover.png"]);

    await asOwner(() =>
      autosave.runBuilderArticleAutosaveWithDeps(
        { documentId: ids.rowDocumentId },
        deps,
      ),
    );

    expect(executeWrite).not.toHaveBeenCalled();
  });

  it("empties Builder's image when it's cleared in Content", async () => {
    const ids = await builderHolds({
      "data.image": "https://cdn.builder.io/cover.png",
    });
    const image = await addBuilderField(ids, "Image", "data.image", {
      type: "files_media",
      sourceFieldType: "file",
    });
    const { deps, executeWrite } = harness({
      entryId: ids.entryId,
      live: builderLive(ids, {
        "data.image": "https://cdn.builder.io/cover.png",
      }),
    });
    await fill(ids, image, ["https://cdn.builder.io/cover.png"]);
    await fill(ids, image, null);

    await asOwner(() =>
      autosave.runBuilderArticleAutosaveWithDeps(
        { documentId: ids.rowDocumentId },
        deps,
      ),
    );

    expect(executeWrite).toHaveBeenCalledTimes(1);
    const [{ request }] = executeWrite.mock.calls[0] as unknown as [
      { request: { body: { data: Record<string, unknown> } } },
    ];
    expect(request.body.data).toEqual({ image: null });
  });

  it("turns down an Author that isn't one of the field's options", async () => {
    const ids = await seedArticle();
    const author = await addBuilderField(ids, "Author", "data.author", {
      type: "select",
      sourceFieldType: "reference",
      options: [{ id: "author_1", name: "Builder Team", color: "gray" }],
    });

    await expect(fill(ids, author, "made_up")).rejects.toMatchObject({
      errorCode: "INVALID_PROPERTY_VALUE",
    });
    await fill(ids, author, "author_1");
  });

  it("leaves Builder alone when a run finds nothing new to save", async () => {
    const ids = await seedArticle();
    const { deps, executeWrite, readLiveEntry } = harness({
      entryId: ids.entryId,
    });
    const run = () =>
      asOwner(() =>
        autosave.runBuilderArticleAutosaveWithDeps(
          { documentId: ids.rowDocumentId },
          deps,
        ),
      );

    await run();
    const again = await run();

    expect(executeWrite).toHaveBeenCalledTimes(1);
    expect(readLiveEntry).toHaveBeenCalledTimes(1);
    expect(again.autosave).toMatchObject({ state: "saved", due: false });
  });

  it("turns itself off once Builder's live entry reads as published", async () => {
    const ids = await seedArticle();
    const { deps, executeWrite } = harness({
      entryId: ids.entryId,
      live: { ...liveDraft(ids.entryId), published: "published" },
    });

    const status = await asOwner(() =>
      autosave.runBuilderArticleAutosaveWithDeps(
        { documentId: ids.rowDocumentId },
        deps,
      ),
    );

    expect(executeWrite).not.toHaveBeenCalled();
    expect(status.autosave).toMatchObject({
      enabled: false,
      state: "review",
      reason: "published",
      due: false,
    });
    expect((await record(ids.sourceId, ids.rowDocumentId)).enabled).toBe(0);
  });

  it("says so, without saving, when Content's copy already reads as published", async () => {
    const ids = await seedArticle({ published: "published" });
    const { deps, executeWrite, readLiveEntry } = harness({
      entryId: ids.entryId,
    });

    const status = await asOwner(() =>
      autosave.runBuilderArticleAutosaveWithDeps(
        { documentId: ids.rowDocumentId },
        deps,
      ),
    );

    expect(readLiveEntry).not.toHaveBeenCalled();
    expect(executeWrite).not.toHaveBeenCalled();
    expect(status.autosave).toMatchObject({
      state: "review",
      reason: "published",
    });
    await expect(
      asOwner(() =>
        setAutosave.run(
          { rowDocumentId: ids.rowDocumentId, enabled: true },
          { caller: "frontend", userEmail: OWNER },
        ),
      ),
    ).rejects.toThrow(/published in Builder/);
  });

  it("waits while Builder's editor holds changes Content didn't make", async () => {
    const ids = await seedArticle();
    const { deps, executeWrite } = harness({
      entryId: ids.entryId,
      live: { ...liveDraft(ids.entryId), hasAutosaves: true },
    });

    const status = await asOwner(() =>
      autosave.runBuilderArticleAutosaveWithDeps(
        { documentId: ids.rowDocumentId },
        deps,
      ),
    );

    expect(executeWrite).not.toHaveBeenCalled();
    expect(status.autosave).toMatchObject({
      enabled: true,
      state: "waiting",
      reason: "builder_editor_changes",
    });
  });

  it("keeps a good save through the switch, and clears a stop", async () => {
    const saved = await seedArticle();
    const stopped = await seedArticle();
    const saving = await seedArticle();
    await getDb()
      .update(schema.contentDatabaseBuilderAutosaves)
      .set({ state: "waiting", reason: "builder_editor_changes" })
      .where(
        eq(schema.contentDatabaseBuilderAutosaves.sourceId, stopped.sourceId),
      );
    await getDb()
      .update(schema.contentDatabaseBuilderAutosaves)
      .set({ state: "saving" })
      .where(
        eq(schema.contentDatabaseBuilderAutosaves.sourceId, saving.sourceId),
      );
    const flip = (rowDocumentId: string, enabled: boolean) =>
      asOwner(() =>
        setAutosave.run(
          { rowDocumentId, enabled },
          { caller: "frontend", userEmail: OWNER },
        ),
      );

    await flip(saved.rowDocumentId, false);
    const savedAgain = await flip(saved.rowDocumentId, true);
    await flip(stopped.rowDocumentId, false);
    const stoppedAgain = await flip(stopped.rowDocumentId, true);
    await flip(saving.rowDocumentId, false);
    const savingAgain = await flip(saving.rowDocumentId, true);

    expect(savedAgain.autosave).toMatchObject({
      enabled: true,
      state: "saved",
      lastSavedAt: "2026-06-29T14:00:00.000Z",
    });
    expect(stoppedAgain.autosave).toMatchObject({
      enabled: true,
      state: "idle",
      reason: null,
    });
    expect(savingAgain.autosave).toMatchObject({
      enabled: true,
      state: "saving",
    });
  });

  it("refuses a page the caller can't edit before saying whether it's an article", async () => {
    const ids = await seedArticle();
    const plain = `doc_plain_${++counter}`;
    await getDb().insert(schema.documents).values({
      id: plain,
      ownerEmail: OWNER,
      title: "Plain page",
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    });
    const { deps } = harness({ entryId: ids.entryId });
    const refusals = async (rowDocumentId: string) => {
      const refusal = (fn: () => Promise<unknown>) =>
        runWithRequestContext({ userEmail: WRITER }, fn).then(
          () => "allowed",
          (error: unknown) =>
            (error instanceof Error ? error.message : String(error)).replaceAll(
              rowDocumentId,
              "<page>",
            ),
        );
      return [
        await refusal(() =>
          setAutosave.run(
            { rowDocumentId, enabled: false },
            { caller: "frontend", userEmail: WRITER },
          ),
        ),
        await refusal(() =>
          autosave.runBuilderArticleAutosaveWithDeps(
            { documentId: rowDocumentId },
            deps,
          ),
        ),
      ];
    };

    const forArticle = await refusals(ids.rowDocumentId);
    const forPlainPage = await refusals(plain);

    expect(forPlainPage).toEqual(forArticle);
    expect(forArticle.join(" ")).not.toMatch(/allowed|row in a collection/);
  });

  it("fails with Retry when Builder's copy changed, and Retry reads it first", async () => {
    const ids = await seedArticle();
    const changed = harness({
      entryId: ids.entryId,
      live: {
        ...liveDraft(ids.entryId),
        lastUpdated: LAST_UPDATED_MS + 1000,
        values: { "data.title": "Renamed in Builder", published: "draft" },
      },
    });

    const failed = await asOwner(() =>
      autosave.runBuilderArticleAutosaveWithDeps(
        { documentId: ids.rowDocumentId },
        changed.deps,
      ),
    );
    expect(changed.executeWrite).not.toHaveBeenCalled();
    expect(failed.autosave).toMatchObject({
      state: "failed",
      reason: "builder_changed",
      due: false,
    });

    await asOwner(() =>
      autosave.runBuilderArticleAutosaveWithDeps(
        { documentId: ids.rowDocumentId },
        changed.deps,
      ),
    );
    expect(changed.readLiveEntry).toHaveBeenCalledTimes(1);

    const retried = harness({ entryId: ids.entryId });
    const saved = await asOwner(() =>
      autosave.runBuilderArticleAutosaveWithDeps(
        { documentId: ids.rowDocumentId, retry: true },
        retried.deps,
      ),
    );
    expect(retried.refreshSource).toHaveBeenCalledTimes(1);
    expect(retried.executeWrite).toHaveBeenCalledTimes(1);
    expect(saved.autosave).toMatchObject({ state: "saved" });
  });

  it("never resends after an unknown outcome; it waits to check Builder's copy", async () => {
    const ids = await seedArticle();
    const ambiguous = harness({
      entryId: ids.entryId,
      write: {
        ok: false,
        status: 0,
        responseBody: null,
        ambiguity: "transport",
        error:
          "Builder write transport failed after dispatch; remote outcome is unknown.",
      },
    });

    const first = await asOwner(() =>
      autosave.runBuilderArticleAutosaveWithDeps(
        { documentId: ids.rowDocumentId },
        ambiguous.deps,
      ),
    );
    expect(first.autosave).toMatchObject({
      state: "waiting",
      reason: "checking_last_save",
    });

    const second = await asOwner(() =>
      autosave.runBuilderArticleAutosaveWithDeps(
        { documentId: ids.rowDocumentId },
        ambiguous.deps,
      ),
    );
    expect(second.autosave).toMatchObject({
      state: "waiting",
      reason: "checking_last_save",
    });
    expect(ambiguous.executeWrite).toHaveBeenCalledTimes(1);
  });

  it("never sends a save with a lost response again; it stops for Review Builder update", async () => {
    const ids = await seedArticle();
    const lost = harness({
      entryId: ids.entryId,
      write: {
        ok: false,
        status: 0,
        responseBody: null,
        ambiguity: "transport",
        error:
          "Builder write transport failed after dispatch; remote outcome is unknown.",
      },
    });
    const run = () =>
      asOwner(() =>
        autosave.runBuilderArticleAutosaveWithDeps(
          { documentId: ids.rowDocumentId },
          lost.deps,
        ),
      );

    expect((await run()).autosave).toMatchObject({
      state: "waiting",
      reason: "checking_last_save",
    });
    await age(ids.sourceId);
    const stopped = await run();
    await age(ids.sourceId);
    const still = await run();

    expect(stopped.autosave).toMatchObject({
      enabled: true,
      state: "review",
      reason: "unconfirmed_save",
    });
    expect(still.autosave).toMatchObject({
      state: "review",
      reason: "unconfirmed_save",
    });
    expect(lost.executeWrite).toHaveBeenCalledTimes(1);
    expect(lost.readLiveEntry).toHaveBeenCalledTimes(1);
    expect(await executionStates(ids.sourceId)).toEqual([
      "reconciliation_required",
    ]);

    await getDb()
      .update(schema.contentDatabaseSourceExecutions)
      .set({ state: "succeeded" })
      .where(eq(schema.contentDatabaseSourceExecutions.sourceId, ids.sourceId));
    await age(ids.sourceId);
    const settled = await run();
    expect(settled.autosave?.reason).not.toBe("unconfirmed_save");
    expect(lost.executeWrite).toHaveBeenCalledTimes(1);
  });

  it("settles a response Builder sent before the server stopped, and keeps a newer edit unsaved", async () => {
    const ids = await seedArticle();
    const stopped = harness({
      entryId: ids.entryId,
      executionDeps: {
        reconcileWrite: async () => {
          throw new Error("The server stopped.");
        },
      },
    });
    await asOwner(() =>
      autosave.runBuilderArticleAutosaveWithDeps(
        { documentId: ids.rowDocumentId },
        stopped.deps,
      ),
    );
    await getDb()
      .update(schema.contentDatabaseSourceExecutions)
      .set({ state: "response_received", updatedAt: SEEDED_AT })
      .where(eq(schema.contentDatabaseSourceExecutions.sourceId, ids.sourceId));
    await getDb()
      .update(schema.contentDatabaseBuilderAutosaves)
      .set({ state: "saving", attemptId: "stopped", updatedAt: SEEDED_AT })
      .where(eq(schema.contentDatabaseBuilderAutosaves.sourceId, ids.sourceId));
    await getDb()
      .update(schema.documents)
      .set({ updatedAt: "2026-06-29T15:30:00.000Z" })
      .where(eq(schema.documents.id, ids.rowDocumentId));

    const resumed = harness({ entryId: ids.entryId });
    const status = await asOwner(() =>
      autosave.runBuilderArticleAutosaveWithDeps(
        { documentId: ids.rowDocumentId },
        resumed.deps,
      ),
    );

    expect(stopped.executeWrite).toHaveBeenCalledTimes(1);
    expect(resumed.executeWrite).not.toHaveBeenCalled();
    expect(resumed.readLiveEntry).not.toHaveBeenCalled();
    expect(status.autosave).toMatchObject({ state: "saved" });
    expect(await executionStates(ids.sourceId)).toEqual(["succeeded"]);
    const saved = await record(ids.sourceId, ids.rowDocumentId);
    expect(saved.savedEditAt).toBe("2026-06-29T14:00:00.000Z");
    expect(saved.lastSavedAt).not.toBe("2026-06-29T14:00:00.000Z");
    const later = new Date(Date.now() + 60_000).toISOString();
    const listed = await asOwner(() => listRows(ids.rowDocumentId, later));
    expect(listed.rows[0]?.autosave?.due).toBe(true);
  });

  it("uses the article's Builder collection when the article is also in another collection", async () => {
    const ids = await seedArticle();
    const files = await addMembership(ids, "files");

    const listed = await asOwner(() =>
      listRows(ids.rowDocumentId, "2026-06-29T15:00:10.000Z"),
    );
    expect(listed.rows).toEqual([
      expect.objectContaining({
        documentId: ids.rowDocumentId,
        databaseId: ids.databaseId,
        sourceId: ids.sourceId,
      }),
    ]);
    const { deps, executeWrite } = harness({ entryId: ids.entryId });
    const saved = await asOwner(() =>
      autosave.runBuilderArticleAutosaveWithDeps(
        {
          documentId: ids.rowDocumentId,
          databaseId: ids.databaseId,
          sourceId: ids.sourceId,
        },
        deps,
      ),
    );
    expect(saved.autosave).toMatchObject({ state: "saved" });
    expect(executeWrite).toHaveBeenCalledTimes(1);

    const flip = (args: { databaseId?: string; sourceId?: string }) =>
      asOwner(() =>
        setAutosave.run(
          { rowDocumentId: ids.rowDocumentId, enabled: false, ...args },
          { caller: "frontend", userEmail: OWNER },
        ),
      );
    await expect(flip({ databaseId: files })).rejects.toThrow(
      /only for articles created/,
    );
    await expect(flip({ sourceId: "src_elsewhere" })).rejects.toThrow(
      /source changed/,
    );

    await getDb()
      .insert(schema.contentDatabaseSources)
      .values({
        id: `src_${files}`,
        ownerEmail: OWNER,
        databaseId: files,
        sourceType: "builder-cms",
        sourceName: "Builder CMS",
        sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
        capabilitiesJson: capabilities,
        metadataJson: JSON.stringify({ primaryKey: "id" }),
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
      });
    await expect(
      asOwner(() => autosave.resolveArticleDatabase(ids.rowDocumentId)),
    ).rejects.toThrow(/more than one Builder collection/);
    await getDb()
      .update(schema.contentDatabases)
      .set({ deletedAt: SEEDED_AT })
      .where(eq(schema.contentDatabases.id, files));
    expect(
      (await asOwner(() => autosave.resolveArticleDatabase(ids.rowDocumentId)))
        ?.id,
    ).toBe(ids.databaseId);
    await getDb()
      .update(schema.contentDatabases)
      .set({ deletedAt: null })
      .where(eq(schema.contentDatabases.id, files));
    await expect(
      runWithRequestContext({ userEmail: WRITER }, () =>
        listAutosaves.run(
          { rowDocumentId: ids.rowDocumentId },
          { caller: "frontend", userEmail: WRITER },
        ),
      ),
    ).rejects.toThrow(/No access/);
    const reader = "reader@example.com";
    const share = (resourceId: string) =>
      getDb()
        .insert(schema.documentShares)
        .values({
          id: `share-${resourceId}-reader`,
          resourceId,
          principalType: "user",
          principalId: reader,
          role: "viewer",
          createdBy: OWNER,
          createdAt: SEEDED_AT,
        });
    const listAsReader = () =>
      runWithRequestContext({ userEmail: reader }, () =>
        listAutosaves.run(
          { rowDocumentId: ids.rowDocumentId },
          { caller: "frontend", userEmail: reader },
        ),
      );
    await share(ids.rowDocumentId);
    await expect(listAsReader()).resolves.toEqual({
      databaseId: null,
      sourceId: null,
      rows: [],
    });
    await share(`doc_${files}`);
    await expect(listAsReader()).resolves.toMatchObject({
      databaseId: files,
    });
    expect(
      (
        await asOwner(() =>
          autosave.resolveArticleDatabase(ids.rowDocumentId, ids.databaseId),
        )
      )?.id,
    ).toBe(ids.databaseId);
    expect((await record(ids.sourceId, ids.rowDocumentId)).enabled).toBe(1);
  });

  it("refuses someone who can edit the article but not its collection", async () => {
    const ids = await seedArticle();
    await getDb()
      .update(schema.documents)
      .set({ ownerEmail: WRITER })
      .where(eq(schema.documents.id, ids.rowDocumentId));
    const asWriter = <T>(fn: () => Promise<T>) =>
      runWithRequestContext({ userEmail: WRITER }, fn);
    await asWriter(() => assertAccess("document", ids.rowDocumentId, "editor"));
    const { deps, executeWrite } = harness({ entryId: ids.entryId });

    await expect(
      asWriter(() =>
        setAutosave.run(
          { rowDocumentId: ids.rowDocumentId, enabled: false },
          { caller: "frontend", userEmail: WRITER },
        ),
      ),
    ).rejects.toThrow(/isn't a row in a collection/);
    await expect(
      asWriter(() =>
        autosave.runBuilderArticleAutosaveWithDeps(
          {
            documentId: ids.rowDocumentId,
            databaseId: ids.databaseId,
            sourceId: ids.sourceId,
          },
          deps,
        ),
      ),
    ).rejects.toThrow(/isn't a row in a collection/);

    await expect(
      asWriter(() =>
        listAutosaves.run(
          { rowDocumentId: ids.rowDocumentId },
          { caller: "frontend", userEmail: WRITER },
        ),
      ),
    ).resolves.toEqual({ databaseId: null, sourceId: null, rows: [] });

    expect(executeWrite).not.toHaveBeenCalled();
    expect(await record(ids.sourceId, ids.rowDocumentId)).toMatchObject({
      enabled: 1,
      state: "saved",
    });
  });

  it("settles a save the server stopped after Builder took it without marking a newer edit saved", async () => {
    const ids = await seedArticle();
    const first = harness({ entryId: ids.entryId });
    await asOwner(() =>
      autosave.runBuilderArticleAutosaveWithDeps(
        { documentId: ids.rowDocumentId },
        first.deps,
      ),
    );
    expect(await executionStates(ids.sourceId)).toEqual(["succeeded"]);
    expect((await record(ids.sourceId, ids.rowDocumentId)).claimedEditAt).toBe(
      SEEDED_AT,
    );
    await getDb()
      .update(schema.contentDatabaseBuilderAutosaves)
      .set({
        state: "saving",
        attemptId: "stopped",
        savedEditAt: "2026-06-29T14:00:00.000Z",
        updatedAt: SEEDED_AT,
      })
      .where(eq(schema.contentDatabaseBuilderAutosaves.sourceId, ids.sourceId));
    await getDb()
      .update(schema.documents)
      .set({ updatedAt: "2026-06-29T15:30:00.000Z" })
      .where(eq(schema.documents.id, ids.rowDocumentId));

    const resumed = harness({ entryId: ids.entryId });
    const status = await asOwner(() =>
      autosave.runBuilderArticleAutosaveWithDeps(
        { documentId: ids.rowDocumentId },
        resumed.deps,
      ),
    );

    expect(first.executeWrite).toHaveBeenCalledTimes(1);
    expect(resumed.executeWrite).not.toHaveBeenCalled();
    expect(status.autosave).toMatchObject({ state: "saved" });
    const saved = await record(ids.sourceId, ids.rowDocumentId);
    expect(saved.savedEditAt).toBe(SEEDED_AT);
    expect(saved.attemptId).toBeNull();
    const listed = await asOwner(() =>
      listRows(ids.rowDocumentId, "2026-06-29T15:31:00.000Z"),
    );
    expect(listed.rows[0]?.autosave?.due).toBe(true);
  });

  it("lists only the rows the caller can open", async () => {
    const ids = await seedArticle();
    const viewer = "viewer@example.com";
    const share = (resourceId: string) =>
      getDb()
        .insert(schema.documentShares)
        .values({
          id: `share-${resourceId}`,
          resourceId,
          principalType: "user",
          principalId: viewer,
          role: "viewer",
          createdBy: OWNER,
          createdAt: SEEDED_AT,
        });
    const asViewer = <T>(fn: () => Promise<T>) =>
      runWithRequestContext({ userEmail: viewer }, fn);
    const list = () =>
      asViewer(() =>
        listAutosaves.run(
          { databaseId: ids.databaseId },
          { caller: "frontend", userEmail: viewer },
        ),
      );
    await share(ids.databaseDocumentId);
    await asViewer(() =>
      assertAccess("document", ids.databaseDocumentId, "viewer"),
    );

    expect((await list()).rows).toEqual([]);
    expect(
      (
        await asOwner(() =>
          listAutosaves.run(
            { databaseId: ids.databaseId },
            { caller: "frontend", userEmail: OWNER },
          ),
        )
      ).rows,
    ).toEqual([expect.objectContaining({ documentId: ids.rowDocumentId })]);

    await share(ids.rowDocumentId);
    expect((await list()).rows).toEqual([
      expect.objectContaining({ documentId: ids.rowDocumentId }),
    ]);
  });

  it("lets only someone who can edit the collection and the article save it", async () => {
    const ids = await seedArticle();
    const editor = "editor@example.com";
    const now = "2026-06-29T15:31:00.000Z";
    const share = (resourceId: string, role: "viewer" | "editor") =>
      getDb()
        .insert(schema.documentShares)
        .values({
          id: `share-${resourceId}-${role}`,
          resourceId,
          principalType: "user",
          principalId: editor,
          role,
          createdBy: OWNER,
          createdAt: SEEDED_AT,
        });
    const listed = async () =>
      (
        await runWithRequestContext({ userEmail: editor }, () =>
          listRows(ids.rowDocumentId, now),
        )
      ).rows[0]?.autosave;
    await share(ids.databaseDocumentId, "editor");
    await share(ids.rowDocumentId, "viewer");

    expect(await listed()).toMatchObject({ due: true, canSave: false });
    expect(
      (await asOwner(() => listRows(ids.rowDocumentId, now))).rows[0]?.autosave,
    ).toMatchObject({ due: true, canSave: true });
    expect(
      (
        await asOwner(() =>
          listAutosaves.run(
            { databaseId: ids.databaseId },
            { caller: "frontend", userEmail: OWNER },
          ),
        )
      ).rows[0]?.autosave,
    ).toMatchObject({ due: true, dueSoon: false, canSave: true });

    await getDb()
      .update(schema.documentShares)
      .set({ role: "editor" })
      .where(eq(schema.documentShares.id, `share-${ids.rowDocumentId}-viewer`));
    expect(await listed()).toMatchObject({ due: true, canSave: true });
  });

  it("keeps a row due while another of its changes still waits to save", async () => {
    const ids = await seedArticle();
    const { deps, executeWrite } = harness({ entryId: ids.entryId });
    const withSecondChange: typeof deps = {
      ...deps,
      getSourceSnapshot: async (args) => {
        const snapshot = await deps.getSourceSnapshot(args);
        const change = snapshot?.changeSets.find(
          (changeSet) => changeSet.direction === "outbound",
        );
        return snapshot && change
          ? {
              ...snapshot,
              changeSets: [
                ...snapshot.changeSets,
                { ...change, id: `${change.id}-second` },
              ],
            }
          : snapshot;
      },
    };

    await asOwner(() =>
      autosave.runBuilderArticleAutosaveWithDeps(
        { documentId: ids.rowDocumentId },
        withSecondChange,
      ),
    );

    expect(executeWrite).toHaveBeenCalledTimes(1);
    expect((await record(ids.sourceId, ids.rowDocumentId)).savedEditAt).toBe(
      "2026-06-29T14:00:00.000Z",
    );
    const listed = await asOwner(() =>
      listRows(ids.rowDocumentId, "2026-06-29T15:31:00.000Z"),
    );
    expect(listed.rows[0]?.autosave?.due).toBe(true);
  });

  it("leaves a trashed row out and won't save it", async () => {
    const ids = await seedArticle();
    await getDb()
      .update(schema.documents)
      .set({
        trashedAt: "2026-06-29T15:30:00.000Z",
        updatedAt: "2026-06-29T15:30:00.000Z",
      })
      .where(eq(schema.documents.id, ids.rowDocumentId));
    const { deps, executeWrite } = harness({ entryId: ids.entryId });

    const listed = await asOwner(() =>
      listRows(ids.rowDocumentId, "2026-06-29T15:31:00.000Z"),
    );
    expect(listed.rows).toEqual([]);
    await expect(
      asOwner(() =>
        autosave.runBuilderArticleAutosaveWithDeps(
          { documentId: ids.rowDocumentId, databaseId: ids.databaseId },
          {
            ...deps,
            assertPageEditor: async () => {},
            now: () => "2026-06-29T15:31:00.000Z",
          },
        ),
      ),
    ).rejects.toThrow(/only for articles created/);
    expect(executeWrite).not.toHaveBeenCalled();
    expect(await record(ids.sourceId, ids.rowDocumentId)).toMatchObject({
      state: "saved",
      savedEditAt: "2026-06-29T14:00:00.000Z",
    });
  });

  it("leaves an article that was already in Builder to the review", async () => {
    const ids = await seedArticle({ record: false });
    const { deps, executeWrite } = harness({ entryId: ids.entryId });

    await expect(
      asOwner(() =>
        autosave.runBuilderArticleAutosaveWithDeps(
          { documentId: ids.rowDocumentId },
          deps,
        ),
      ),
    ).rejects.toThrow(/only for articles created/);
    expect(executeWrite).not.toHaveBeenCalled();

    const listed = await asOwner(() =>
      listRows(ids.rowDocumentId, "2026-06-29T15:00:10.000Z"),
    );
    expect(listed.rows).toEqual([
      expect.objectContaining({
        documentId: ids.rowDocumentId,
        builderUrl: `https://builder.io/content/${ids.entryId}`,
        autosave: null,
      }),
    ]);
  });

  it("marks a row whose edits are still settling so the page checks again soon", async () => {
    const ids = await seedArticle();
    const at = async (now: string) =>
      (await asOwner(() => listRows(ids.rowDocumentId, now))).rows[0]?.autosave;

    expect(await at("2026-06-29T15:00:01.000Z")).toMatchObject({
      due: false,
      dueSoon: true,
    });
    expect(await at("2026-06-29T15:00:04.000Z")).toMatchObject({
      due: true,
      dueSoon: false,
    });
  });

  it("is due only once a new row's edits have sat still", async () => {
    const ids = await seedArticle({ linked: false });
    const due = async (now: string) =>
      (await asOwner(() => listRows(ids.rowDocumentId, now))).rows[0]?.autosave
        ?.due;

    expect(await due("2026-06-29T15:00:01.000Z")).toBe(false);
    expect(await due("2026-06-29T15:00:05.000Z")).toBe(true);
    expect(await due("2026-06-29T16:00:00.000Z")).toBe(false);
  });

  it("creates a new row as a Builder draft and keeps a later edit due", async () => {
    const ids = await seedArticle({ linked: false });
    const created = `created_${ids.entryId}`;
    const { deps, executeWrite } = harness({ entryId: created });
    executeWrite.mockImplementationOnce(async () => {
      await getDb()
        .update(schema.documents)
        .set({ updatedAt: "2026-06-29T15:00:30.000Z" })
        .where(eq(schema.documents.id, ids.rowDocumentId));
      return {
        ok: true,
        status: 200,
        entryId: created,
        responseBody: {
          id: created,
          published: "draft",
          lastUpdated: LAST_UPDATED_MS,
          data: { title: "New title" },
        },
      };
    });

    const status = await asOwner(() =>
      autosave.runBuilderArticleAutosaveWithDeps(
        { documentId: ids.rowDocumentId },
        { ...deps, now: () => "2026-06-29T15:00:05.000Z" },
      ),
    );

    expect(executeWrite).toHaveBeenCalledTimes(1);
    const [{ request }] = executeWrite.mock.calls[0] as unknown as [
      { request: { method: string; body: { published?: string } } },
    ];
    expect(request.method).toBe("POST");
    expect(request.body.published).toBe("draft");
    expect(status).toMatchObject({
      entryId: created,
      builderUrl: `https://builder.io/content/${created}`,
      autosave: { state: "saved", enabled: true },
    });
    const listed = await asOwner(() =>
      listRows(ids.rowDocumentId, "2026-06-29T15:00:40.000Z"),
    );
    expect(listed.rows[0]?.autosave?.due).toBe(true);
  });

  it("creates a new article as a Builder draft before Builder's required fields are filled", async () => {
    const ids = await seedArticle({ linked: false });
    await getDb()
      .update(schema.contentDatabaseSources)
      .set({
        metadataJson: JSON.stringify({
          primaryKey: "id",
          titleField: "title",
          writeMode: "stage_only",
          pushMode: "autosave",
          liveReadConfigured: true,
          builderModelFields: [
            { name: "title", type: "text", required: true },
            {
              name: "author",
              type: "reference",
              model: "blog-author",
              required: true,
            },
          ],
        }),
      })
      .where(eq(schema.contentDatabaseSources.id, ids.sourceId));
    const created = `created_${ids.entryId}`;
    const { deps, executeWrite } = harness({ entryId: created });

    const status = await asOwner(() =>
      autosave.runBuilderArticleAutosaveWithDeps(
        { documentId: ids.rowDocumentId },
        { ...deps, now: () => "2026-06-29T15:00:05.000Z" },
      ),
    );

    expect(executeWrite).toHaveBeenCalledTimes(1);
    const [{ request }] = executeWrite.mock.calls[0] as unknown as [
      {
        request: {
          method: string;
          body: { published?: string; data: Record<string, unknown> };
        };
      },
    ];
    expect(request.method).toBe("POST");
    expect(request.body.published).toBe("draft");
    expect(request.body.data).not.toHaveProperty("author");
    expect(status.autosave).toMatchObject({ state: "saved", error: null });
  });

  async function createFromTitleThenType(body: string) {
    const ids = await seedArticle({ linked: false });
    const created = `created_${ids.entryId}`;
    const live: BuilderCmsEntryLiveState = {
      ...liveDraft(created),
      lastUpdated: LAST_UPDATED_MS + 5000,
      values: { "data.title": "New title", published: "draft" },
    };
    const { deps, executeWrite, readBody, readLiveEntry, refreshSource } =
      harness({
        entryId: created,
        live,
      });
    const run = (now: string, retry = false) =>
      asOwner(() =>
        autosave.runBuilderArticleAutosaveWithDeps(
          { documentId: ids.rowDocumentId, retry },
          { ...deps, now: () => now },
        ),
      );
    await run("2026-06-29T15:00:05.000Z");
    expect(executeWrite).toHaveBeenCalledTimes(1);
    await getDb()
      .update(schema.documents)
      .set({ content: body, updatedAt: "2026-06-29T15:00:30.000Z" })
      .where(eq(schema.documents.id, ids.rowDocumentId));
    const blocks = [
      {
        "@type": "@builder.io/sdk:Element",
        "@version": 2,
        id: "text-typed-in-builder",
        component: {
          name: "Text",
          options: { text: "<p>Typed in Builder.</p>" },
        },
      },
    ];
    live.blocksHash = null;
    const typeBodyInBuilder = (lastUpdated: number) => {
      live.blocksHash = builderBlocksHash(blocks);
      live.lastUpdated = lastUpdated;
    };
    const readBuilderBody = async () => {
      const entry = normalizeBuilderCmsApiEntry(
        {
          id: created,
          name: "New title",
          published: "draft",
          lastUpdated: Number(live.lastUpdated),
          data: { title: "New title", blocks },
        },
        BUILDER_CMS_SAFE_WRITE_MODEL,
      );
      if (!entry) throw new Error("Builder's entry couldn't be read.");
      await utils.enqueueBuilderBodyHydration({
        sourceId: ids.sourceId,
        ownerEmail: OWNER,
        orgId: null,
        databaseItemId: ids.itemId,
        documentId: ids.rowDocumentId,
        sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
        entry,
        now: new Date().toISOString(),
        priority: -1,
      });
      const read = await utils.processBuilderBodyHydrationQueue({
        sourceId: ids.sourceId,
        limit: 1,
      });
      expect(read).toMatchObject({ succeeded: 1, failed: 0 });
    };
    return {
      deps,
      executeWrite,
      ids,
      live,
      readBody,
      readBuilderBody,
      readLiveEntry,
      refreshSource,
      run,
      typeBodyInBuilder,
    };
  }

  const setBodyHydration = (
    itemId: string,
    status: string,
    error: string | null = null,
  ) =>
    getDb()
      .update(schema.contentDatabaseItems)
      .set({ bodyHydrationStatus: status, bodyHydrationError: error })
      .where(eq(schema.contentDatabaseItems.id, itemId));

  it("saves a body typed after an article's first save", async () => {
    const { executeWrite, run } = await createFromTitleThenType(
      "Typed after the title was saved.",
    );

    const status = await run("2026-06-29T15:00:40.000Z");

    expect(executeWrite).toHaveBeenCalledTimes(2);
    const [[create], [save]] = executeWrite.mock.calls as unknown as [
      { request: { method: string; body: { data: { blocks?: unknown[] } } } },
    ][];
    expect(create.request.method).toBe("POST");
    expect(create.request.body.data).not.toHaveProperty("blocks");
    expect(save.request.method).toBe("PATCH");
    expect(JSON.stringify(save.request.body.data.blocks)).toContain(
      "Typed after the title was saved.",
    );
    expect(status.autosave).toMatchObject({ state: "saved", error: null });
  });

  it("won't save a body over one Builder gained after the first save", async () => {
    const { executeWrite, live, run } = await createFromTitleThenType(
      "Typed after the title was saved.",
    );
    live.blocksHash = "body-typed-in-builder";

    const status = await run("2026-06-29T15:00:40.000Z");

    expect(executeWrite).toHaveBeenCalledTimes(1);
    expect(status.autosave?.state).not.toBe("saved");
  });

  it("won't save over that body on a retry that has refreshed the row", async () => {
    const { executeWrite, ids, live, refreshSource, run } =
      await createFromTitleThenType("Typed after the title was saved.");
    const lastUpdated = LAST_UPDATED_MS + 9000;
    live.blocksHash = "body-typed-in-builder";
    live.lastUpdated = lastUpdated;
    const stopped = await run("2026-06-29T15:00:40.000Z");
    expect(stopped.autosave?.reason).toBe("builder_changed");
    refreshSource.mockImplementation(async () => {
      await getDb()
        .update(schema.contentDatabaseSourceRows)
        .set({
          sourceValuesJson: JSON.stringify({
            "data.title": "New title",
            published: "draft",
            lastUpdated: String(lastUpdated),
            "__builder.body.blocksHash": "body-typed-in-builder",
            "__builder.body.blockCount": 1,
          }),
          lastSourceUpdatedAt: String(lastUpdated),
        })
        .where(eq(schema.contentDatabaseSourceRows.sourceId, ids.sourceId));
      await setBodyHydration(ids.itemId, "pending");
      return {};
    });

    const status = await run("2026-06-29T15:01:40.000Z", true);

    expect(refreshSource).toHaveBeenCalledTimes(1);
    expect(executeWrite).toHaveBeenCalledTimes(1);
    expect(status.autosave?.state).not.toBe("saved");
  });

  it.each([1000, 0])(
    "won't save over that body on a retry that has read it %i ms newer",
    async (newerBy) => {
      const {
        executeWrite,
        live,
        readBuilderBody,
        refreshSource,
        run,
        typeBodyInBuilder,
      } = await createFromTitleThenType("Typed after the title was saved.");
      typeBodyInBuilder(Number(live.lastUpdated) + newerBy);
      const stopped = await run("2026-06-29T15:00:40.000Z");
      expect(stopped.autosave?.reason).toBe("builder_changed");
      refreshSource.mockImplementation(async () => {
        await readBuilderBody();
        return {};
      });

      const status = await run("2026-06-29T15:01:40.000Z", true);

      expect(refreshSource).toHaveBeenCalledTimes(1);
      expect(executeWrite).toHaveBeenCalledTimes(1);
      expect(status.autosave).toMatchObject({
        state: "review",
        reason: "edit_conflict",
      });
    },
  );

  it("needs a new review before a save approved over no body replaces one", async () => {
    const {
      deps,
      executeWrite,
      ids,
      live,
      readBuilderBody,
      readLiveEntry,
      typeBodyInBuilder,
    } = await createFromTitleThenType("Typed after the title was saved.");
    const prepare = async () => {
      const database = await deps.resolveDatabase(ids.rowDocumentId);
      if (!database) throw new Error("The article has no collection.");
      const snapshot = await deps.getSourceSnapshot({
        database,
        sourceId: ids.sourceId,
        documentId: ids.rowDocumentId,
        unreadBodies: new Map(),
      });
      const changeSet = snapshot?.changeSets.findLast(
        (candidate) =>
          candidate.direction === "outbound" && !!candidate.bodyChange,
      );
      if (!changeSet) throw new Error("The article has no body to review.");
      const prepared = await deps.prepareReview({
        databaseId: ids.databaseId,
        sourceId: ids.sourceId,
        changeSetIds: [changeSet.id],
        documentIds: [ids.rowDocumentId],
      });
      return (
        prepared.preparedChangeSetMappings.find(
          (mapping) => mapping.requestedChangeSetId === changeSet.id,
        )?.preparedChangeSetId ?? changeSet.id
      );
    };
    const push = (changeSetId: string) =>
      executeWithDeps(
        {
          databaseId: ids.databaseId,
          sourceId: ids.sourceId,
          changeSetId,
        },
        {
          ...realExecutionDeps(ids.sourceId, changeSetId),
          executeWrite,
          readLiveEntry,
        },
      );

    await asOwner(async () => {
      const approved = await prepare();
      typeBodyInBuilder(Number(live.lastUpdated));
      await expect(push(approved)).rejects.toThrow(
        "Builder body changed since this diff was approved; refresh and re-review.",
      );
      await readBuilderBody();
      await expect(push(approved)).rejects.toThrow(
        "Builder body changed since this change was reviewed. Refresh and review it again.",
      );
      expect(executeWrite).toHaveBeenCalledTimes(1);

      const reviewedAgain = await prepare();
      expect(reviewedAgain).not.toBe(approved);
      await push(reviewedAgain);
      expect(executeWrite).toHaveBeenCalledTimes(2);
    });
  });

  it.each(["pending", "hydrating"])(
    "holds a body back while Builder's is %s",
    async (reading) => {
      const { executeWrite, ids, run } = await createFromTitleThenType(
        "Typed after the title was saved.",
      );
      await setBodyHydration(ids.itemId, reading);

      const waiting = await run("2026-06-29T15:00:40.000Z");

      expect(executeWrite).toHaveBeenCalledTimes(1);
      expect(waiting.autosave).toMatchObject({
        state: "waiting",
        reason: "builder_body_unread",
        due: false,
      });

      await setBodyHydration(ids.itemId, "hydrated");
      const saved = await run("2026-06-29T15:01:40.000Z");

      expect(executeWrite).toHaveBeenCalledTimes(2);
      expect(saved.autosave).toMatchObject({ state: "saved", due: false });
    },
  );

  it.each(["error", "unavailable"])(
    "fails when its body read ended %s, and a retry reads it and saves",
    async (reading) => {
      const { executeWrite, ids, readBody, refreshSource, run } =
        await createFromTitleThenType("Typed after the title was saved.");
      const error = "Builder no longer returns this source entry.";
      await setBodyHydration(ids.itemId, reading, error);

      const failed = await run("2026-06-29T15:00:40.000Z");

      expect(executeWrite).toHaveBeenCalledTimes(1);
      expect(failed.autosave).toMatchObject({
        state: "failed",
        reason: "builder_body_unreadable",
        error,
        canSave: true,
        due: false,
      });

      readBody.mockImplementation(async () => {
        expect(refreshSource).toHaveBeenCalledTimes(1);
        await setBodyHydration(ids.itemId, "hydrated");
        return {};
      });
      const saved = await run("2026-06-29T15:00:50.000Z", true);

      expect(readBody).toHaveBeenCalledExactlyOnceWith({
        sourceId: ids.sourceId,
        documentId: ids.rowDocumentId,
      });
      expect(executeWrite).toHaveBeenCalledTimes(2);
      expect(saved.autosave).toMatchObject({ state: "saved", due: false });
    },
  );

  it("stays failed when a retry still can't read the body", async () => {
    const { executeWrite, ids, readBody, run } = await createFromTitleThenType(
      "Typed after the title was saved.",
    );
    await setBodyHydration(ids.itemId, "error", "Builder didn't answer.");
    await run("2026-06-29T15:00:40.000Z");

    const status = await run("2026-06-29T15:00:50.000Z", true);

    expect(readBody).toHaveBeenCalledTimes(1);
    expect(executeWrite).toHaveBeenCalledTimes(1);
    expect(status.autosave).toMatchObject({
      state: "failed",
      reason: "builder_body_unreadable",
      canSave: true,
    });
  });

  it("saves on its own once a body it couldn't read has been read", async () => {
    const { executeWrite, ids, readBody, refreshSource, run } =
      await createFromTitleThenType("Typed after the title was saved.");
    await setBodyHydration(ids.itemId, "error", "Builder didn't answer.");
    await run("2026-06-29T15:00:40.000Z");
    await setBodyHydration(ids.itemId, "hydrated");

    const saved = await run("2026-06-29T15:01:40.000Z");

    expect(refreshSource).not.toHaveBeenCalled();
    expect(readBody).not.toHaveBeenCalled();
    expect(executeWrite).toHaveBeenCalledTimes(2);
    expect(saved.autosave).toMatchObject({ state: "saved", due: false });
  });

  it("saves a title while the body waits for Builder's", async () => {
    const { executeWrite, ids, run } = await createFromTitleThenType(
      "Typed after the title was saved.",
    );
    await setBodyHydration(ids.itemId, "pending");
    await getDb()
      .update(schema.documents)
      .set({ title: "Newer title", updatedAt: "2026-06-29T15:00:35.000Z" })
      .where(eq(schema.documents.id, ids.rowDocumentId));

    const titleSaved = await run("2026-06-29T15:00:40.000Z");

    expect(executeWrite).toHaveBeenCalledTimes(2);
    expect(titleSaved.autosave).toMatchObject({ state: "saved", due: true });

    const waiting = await run("2026-06-29T15:00:45.000Z");

    expect(executeWrite).toHaveBeenCalledTimes(2);
    expect(waiting.autosave).toMatchObject({
      state: "waiting",
      reason: "builder_body_unread",
    });
  });

  it("doesn't wait for Builder's body when the page's is already saved", async () => {
    const { executeWrite, ids, run } = await createFromTitleThenType(
      "Typed after the title was saved.",
    );
    await run("2026-06-29T15:00:40.000Z");
    await setBodyHydration(ids.itemId, "pending");
    await getDb()
      .update(schema.documents)
      .set({ title: "Newer title", updatedAt: "2026-06-29T15:00:45.000Z" })
      .where(eq(schema.documents.id, ids.rowDocumentId));

    const status = await run("2026-06-29T15:00:50.000Z");

    expect(executeWrite).toHaveBeenCalledTimes(3);
    expect(status.autosave).toMatchObject({ state: "saved", due: false });
  });
});
