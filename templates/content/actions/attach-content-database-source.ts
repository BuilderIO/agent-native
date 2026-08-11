import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type {
  BuilderCmsModelFieldSummary,
  ContentDatabaseSourceAttachmentResult,
  ContentDatabaseSourceFederation,
  ContentDatabaseSourceType,
} from "../shared/api.js";
import { sanitizeNormalizationFormula } from "../shared/properties.js";
import {
  readBuilderCmsContentEntries,
  readBuilderCmsModelFields,
  type BuilderCmsReadResult,
} from "./_builder-cms-read-client.js";
import type { BuilderCmsSourceEntry } from "./_builder-cms-source-adapter.js";
import { getContentDatabaseSourceAdapter } from "./_content-database-source-adapters.js";
import {
  databaseSourceExistsForTable,
  enqueueBuilderBodyHydrationForItems,
  ensureDatabaseSourceProperty,
  getExistingSource,
  getSourceRows,
  importBuilderCmsEntriesAsDatabaseItems,
  insertSecondarySource,
  mapBuilderCmsEntriesToLocalItems,
  replaceMockSourceRows,
  replaceSourceMetadata,
  resolveDatabaseForSourceMutation,
  seedMockSourceFields,
  seedMockSourceRows,
  seedSecondarySourceFields,
  sourceSetupPayload,
  storeSecondarySourceRows,
  updateBuilderCmsSourceReadMetadata,
  updateReadOnlySourceMetadata,
  writeSourceFederation,
} from "./_database-source-utils.js";
import { getContentDatabaseResponse } from "./_database-utils.js";
import {
  readLocalTableEntries,
  resolveReadableLocalTableSource,
} from "./_local-table-source.js";
import { listPropertiesForDatabase } from "./_property-utils.js";

const sourceTypeSchema = z
  .enum(["mock-local", "builder-cms", "local-table", "notion-database"])
  .default("mock-local");
const BUILDER_CMS_ATTACH_INITIAL_PAGES = 1;
const BUILDER_CMS_ATTACH_METADATA_LIMIT = 10_000;

export function shouldBootstrapLocalDetailsSource(args: {
  relationshipMode: "items" | "details" | undefined;
  hasExistingSource: boolean;
}) {
  return args.relationshipMode === "details" && !args.hasExistingSource;
}

export function assertDetailsSourceJoin(args: {
  relationshipMode: "items" | "details" | undefined;
  hasJoin: boolean;
}) {
  if (args.relationshipMode === "details" && !args.hasJoin) {
    throw new Error("Choose a match key before adding source details.");
  }
}

export async function readBeforeLocalDetailsBootstrap<T>(args: {
  readCandidate: () => Promise<T>;
  bootstrapLocalSource: () => Promise<void>;
}) {
  const candidate = await args.readCandidate();
  await args.bootstrapLocalSource();
  return candidate;
}

export async function readInitialBuilderCmsAttachEntries(
  sourceTable: string,
  readEntries: typeof readBuilderCmsContentEntries = readBuilderCmsContentEntries,
  fieldPaths: readonly string[] = [],
) {
  return readEntries({
    model: sourceTable,
    fieldPaths,
    maxPages: BUILDER_CMS_ATTACH_INITIAL_PAGES,
  });
}

export async function readInitialBuilderCmsAttachSource(
  sourceTable: string,
  dependencies: {
    readModelFields?: typeof readBuilderCmsModelFields;
    readEntries?: typeof readBuilderCmsContentEntries;
    fieldPaths?: readonly string[];
  } = {},
) {
  const readModelFields =
    dependencies.readModelFields ?? readBuilderCmsModelFields;
  const readEntries = dependencies.readEntries ?? readBuilderCmsContentEntries;
  const [modelFields, read] = await Promise.all([
    readModelFields({ model: sourceTable }),
    readInitialBuilderCmsAttachEntries(
      sourceTable,
      readEntries,
      dependencies.fieldPaths,
    ),
  ]);
  return { read, modelFields };
}

export async function readCompleteBuilderCmsAttachSource(
  sourceTable: string,
  dependencies: {
    readModelFields?: typeof readBuilderCmsModelFields;
    readEntries?: typeof readBuilderCmsContentEntries;
    fieldPaths?: readonly string[];
  } = {},
) {
  const readModelFields =
    dependencies.readModelFields ?? readBuilderCmsModelFields;
  const readEntries = dependencies.readEntries ?? readBuilderCmsContentEntries;
  const [modelFields, read] = await Promise.all([
    readModelFields({ model: sourceTable }),
    readEntries({
      model: sourceTable,
      fieldPaths: dependencies.fieldPaths,
      allowCached: true,
      limit: BUILDER_CMS_ATTACH_METADATA_LIMIT,
    }),
  ]);
  return { read, modelFields };
}

function builderReadHasMore(read: BuilderCmsReadResult | null | undefined) {
  return read?.state === "live" && read.progress?.hasMore === true;
}

function builderReadActiveSourceRowIds(
  read: BuilderCmsReadResult | null | undefined,
) {
  if (read?.state !== "live" || read.progress?.hasMore !== true) {
    return undefined;
  }
  return read.entries.map((entry) => entry.id);
}

function builderReadSyncState(read: BuilderCmsReadResult) {
  if (read.state === "error") return "error";
  return builderReadHasMore(read) ? "refreshing" : "linked";
}

export function builderCmsAttachReadMetadata(read: BuilderCmsReadResult) {
  const sourceFetchState: "idle" | "fetching" | "error" = builderReadHasMore(
    read,
  )
    ? "fetching"
    : read.state === "error"
      ? "error"
      : "idle";
  const syncState: "linked" | "refreshing" | "error" =
    builderReadSyncState(read);

  return {
    progress: read.progress,
    sourceFetchState,
    activeReadSourceRowIds: builderReadActiveSourceRowIds(read),
    syncState,
  };
}

export function initialBuilderAttachmentSetupOptions(args: {
  builderRead: BuilderCmsReadResult | null;
  importedEntriesByDocumentId: ReadonlyMap<string, BuilderCmsSourceEntry>;
}) {
  if (
    args.builderRead?.state !== "live" ||
    args.importedEntriesByDocumentId.size !== args.builderRead.entries.length
  ) {
    return undefined;
  }
  const documentIds = [...args.importedEntriesByDocumentId.keys()];
  return {
    documentIds,
    limit: Math.max(1, documentIds.length),
    offset: 0,
  };
}

export function builderAttachDurableItemCount(
  builderEntriesByDocumentId:
    | ReadonlyMap<string, BuilderCmsSourceEntry>
    | undefined,
) {
  return builderEntriesByDocumentId?.size ?? 0;
}

// Per-source key mapping the UI commits after the canonical-key confirm step.
const normalizationFormulaSchema = z
  .string()
  .max(1000)
  .refine((value) => sanitizeNormalizationFormula(value) !== null, {
    message:
      "Normalization formula contains an unsafe regex or invalid expression.",
  });

const joinSideSchema = z.object({
  keyField: z.string(),
  normalizationFormula: normalizationFormulaSchema,
});

// Present only when adding a SECOND source — federate it onto the primary on a
// canonical key. Identity joins only in this phase.
const joinSchema = z.object({
  canonicalKey: z.object({
    propertyId: z.string().nullable().optional(),
    label: z.string(),
    type: z.string().default("text"),
  }),
  primary: joinSideSchema,
  secondary: joinSideSchema,
  columnBindings: z
    .array(
      z.object({
        propertyId: z.string().nullable().optional(),
        localFieldKey: z.string().nullable().optional(),
        role: z.enum(["primary", "mirror"]),
        primarySourceId: z.string().nullable().optional(),
        sourceFieldKey: z.string(),
      }),
    )
    .optional(),
});

function identityFederation(
  role: "primary" | "secondary",
  side: z.infer<typeof joinSideSchema>,
  canonicalKey: z.infer<typeof joinSchema>["canonicalKey"],
  columnBindings?: z.infer<typeof joinSchema>["columnBindings"],
): ContentDatabaseSourceFederation {
  return {
    role,
    keyField: side.keyField,
    normalizationFormula: side.normalizationFormula,
    join: {
      kind: "identity",
      collection: null,
      localExpr: "{canonical}",
      remoteKeyField: side.keyField,
      normalizationFormula: side.normalizationFormula,
    },
    canonicalKey: {
      propertyId: canonicalKey.propertyId ?? null,
      label: canonicalKey.label,
      type: canonicalKey.type ?? "text",
    },
    columnBindings:
      role === "secondary"
        ? columnBindings?.map((binding) => ({
            propertyId: binding.propertyId ?? null,
            localFieldKey: binding.localFieldKey ?? null,
            role: binding.role,
            primarySourceId: binding.primarySourceId ?? null,
            sourceFieldKey: binding.sourceFieldKey,
          }))
        : undefined,
  };
}

async function readDetailsSourceCandidate(args: {
  sourceType: ContentDatabaseSourceType;
  sourceTable: string;
  limit: number;
  offset: number;
  now: string;
}) {
  const adapter = getContentDatabaseSourceAdapter(args.sourceType);
  if (adapter) {
    const read = await adapter.read({
      sourceTable: args.sourceTable,
      limit: args.limit,
      offset: args.offset,
    });
    return {
      entries: read.state === "live" ? read.entries : [],
      modelFields: read.fields,
      builderRead:
        args.sourceType === "builder-cms"
          ? ({
              state: read.state,
              entries: read.entries,
              fetchedAt: read.fetchedAt,
              message: read.message,
              progress: read.progress!,
            } satisfies BuilderCmsReadResult)
          : null,
      adapterMetadata: read.metadata,
      adapterFetchedAt: read.fetchedAt,
      adapterMessage: read.message,
    };
  }
  if (args.sourceType === "builder-cms") {
    const initial = await readInitialBuilderCmsAttachSource(args.sourceTable);
    return {
      entries: initial.read.state === "live" ? initial.read.entries : [],
      modelFields: initial.modelFields,
      builderRead: initial.read,
      adapterMetadata: undefined,
      adapterFetchedAt: args.now,
      adapterMessage: null,
    };
  }
  return {
    entries: [] as BuilderCmsSourceEntry[],
    modelFields: [] as BuilderCmsModelFieldSummary[],
    builderRead: null,
    adapterMetadata: undefined,
    adapterFetchedAt: args.now,
    adapterMessage: null,
  };
}

export default defineAction({
  description:
    "Attach or replace a safe local source binding for a content database. Builder CMS bindings store source metadata, field mappings, row identity, provenance, freshness, capabilities, and local-only diff state without calling external APIs.",
  schema: z.object({
    databaseId: z.string().optional().describe("Database ID"),
    documentId: z.string().optional().describe("Database document/page ID"),
    sourceType: sourceTypeSchema.describe(
      "Source type. Defaults to mock-local. Builder CMS is local metadata only in this slice.",
    ),
    sourceName: z
      .string()
      .optional()
      .describe("Display name for the source binding."),
    sourceTable: z
      .string()
      .optional()
      .describe("Source table/model name, for example content_items."),
    builderFieldPaths: z.array(z.string().max(500)).max(200).optional(),
    relationshipMode: z
      .enum(["items", "details"])
      .optional()
      .describe(
        "How to attach a second source: items adds more rows; details joins fields onto existing rows.",
      ),
    join: joinSchema
      .optional()
      .describe(
        "When relationshipMode is details, the canonical-key join that adds fields onto the primary rows.",
      ),
    mode: z
      .enum(["replace", "add"])
      .optional()
      .describe(
        "Backward-compatible alias: add means relationshipMode items; replace (default) re-links the primary source.",
      ),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  }),
  run: async (args): Promise<ContentDatabaseSourceAttachmentResult> => {
    const database = await resolveDatabaseForSourceMutation(args);
    if (!database) throw new Error("Database not found.");
    await assertAccess("document", database.documentId, "editor");

    const now = new Date().toISOString();
    const sourceType = (args.sourceType ??
      "mock-local") as ContentDatabaseSourceType;
    if (sourceType === "notion-database" && !args.sourceTable?.trim()) {
      throw new Error(
        "sourceTable must be a Notion data-source ID returned by list-notion-database-sources.",
      );
    }
    const sourceName =
      args.sourceName?.trim() ||
      (sourceType === "builder-cms"
        ? "Builder CMS"
        : sourceType === "notion-database"
          ? "Notion database"
          : "Mock local source");
    const sourceTable =
      args.sourceTable?.trim() ||
      (sourceType === "builder-cms" ? "blog_article" : "content_items");

    let existingSource = await getExistingSource(database.id);
    if (sourceType === "local-table") {
      if (sourceTable === database.id) {
        throw new Error("A database can't be added as a source of itself.");
      }
      await resolveReadableLocalTableSource(sourceTable);
    }

    const relationshipMode =
      args.relationshipMode ?? (args.mode === "add" ? "items" : undefined);

    // Validate before bootstrapping the local primary so an invalid details
    // attach cannot leave a source record behind.
    assertDetailsSourceJoin({
      relationshipMode,
      hasJoin: Boolean(args.join),
    });

    // A normal local Content database has rows but no explicit source record.
    // A details join needs that local snapshot to remain the primary side;
    // otherwise the candidate source would fall through to replacement semantics.
    let initialDetailsSource:
      | Awaited<ReturnType<typeof readDetailsSourceCandidate>>
      | undefined;
    if (
      shouldBootstrapLocalDetailsSource({
        relationshipMode,
        hasExistingSource: Boolean(existingSource),
      })
    ) {
      initialDetailsSource = await readBeforeLocalDetailsBootstrap({
        readCandidate: () =>
          readDetailsSourceCandidate({
            sourceType,
            sourceTable,
            limit: args.limit,
            offset: args.offset,
            now,
          }),
        bootstrapLocalSource: async () => {
          const setup = await sourceSetupPayload(database.id);
          const localSourceId = await replaceSourceMetadata({
            database,
            source: null,
            sourceType: "mock-local",
            sourceName: "Local Content database",
            sourceTable: database.id,
            now,
          });
          await seedMockSourceFields({
            sourceId: localSourceId,
            ownerEmail: database.ownerEmail,
            sourceType: "mock-local",
            properties: setup.properties,
            now,
          });
          await seedMockSourceRows({
            sourceId: localSourceId,
            ownerEmail: database.ownerEmail,
            sourceType: "mock-local",
            sourceTable: database.id,
            items: setup.response.items,
            now,
          });
        },
      });
      existingSource = await getExistingSource(database.id);
    }

    // Adding a SECOND source as details: relate it onto the primary on the
    // canonical key. Read-only overlay — the secondary's entries are NOT
    // imported as local documents/items.
    if ((relationshipMode === "details" || args.join) && existingSource) {
      if (!args.join) {
        throw new Error("Choose a match key before adding source details.");
      }
      const {
        entries,
        modelFields,
        builderRead,
        adapterMetadata,
        adapterFetchedAt,
        adapterMessage,
      } =
        initialDetailsSource ??
        (await readDetailsSourceCandidate({
          sourceType,
          sourceTable,
          limit: args.limit,
          offset: args.offset,
          now,
        }));

      const secondaryId = await insertSecondarySource({
        database,
        expectedPrimarySourceId: existingSource.id,
        sourceType,
        sourceName,
        sourceTable,
        now,
      });
      await storeSecondarySourceRows({
        sourceId: secondaryId,
        ownerEmail: database.ownerEmail,
        sourceType,
        sourceTable,
        entries,
        now,
      });
      await seedSecondarySourceFields({
        sourceId: secondaryId,
        ownerEmail: database.ownerEmail,
        sourceType,
        modelFields,
        sampleEntry: entries[0],
        now,
      });
      if (sourceType === "builder-cms" && builderRead) {
        await updateBuilderCmsSourceReadMetadata({
          sourceId: secondaryId,
          sourceTable,
          readState: builderRead.state,
          entryCount: builderRead.entries.length,
          matchedRowCount: entries.length,
          fetchedAt: builderRead.fetchedAt,
          now,
          message: builderRead.message,
          builderModelFields: modelFields,
          ...builderCmsAttachReadMetadata(builderRead),
        });
      }
      if (sourceType === "notion-database") {
        await updateReadOnlySourceMetadata({
          sourceId: secondaryId,
          sourceType,
          sourceTable,
          fetchedAt: adapterFetchedAt,
          now,
          message: adapterMessage,
          metadata: adapterMetadata,
        });
      }
      await writeSourceFederation({
        sourceId: secondaryId,
        federation: identityFederation(
          "secondary",
          args.join.secondary,
          args.join.canonicalKey,
          args.join.columnBindings,
        ),
        now,
      });
      await writeSourceFederation({
        sourceId: existingSource.id,
        federation: identityFederation(
          "primary",
          args.join.primary,
          args.join.canonicalKey,
        ),
        now,
      });

      return getContentDatabaseResponse(database.id, {
        limit: args.limit,
        offset: args.offset,
      });
    }

    // Adding an ADDITIONAL writable Builder source (row-union): insert a new
    // source and import its entries as their OWN rows, instead of replacing the
    // primary. No canonical-key join — each row belongs to exactly one source.
    if (
      relationshipMode === "items" &&
      existingSource &&
      sourceType === "builder-cms"
    ) {
      // Don't add the same collection twice — each "add" starts a fresh source
      // with no prior rows, so a duplicate attach would re-import duplicate rows.
      if (await databaseSourceExistsForTable(database.id, sourceTable)) {
        throw new Error(`"${sourceTable}" is already attached as a source.`);
      }
      const additionalInitial =
        await readInitialBuilderCmsAttachSource(sourceTable);
      const additionalModelFields = additionalInitial.modelFields;
      const additionalRead = additionalInitial.read;
      const additionalEntries =
        additionalRead.state === "live" ? additionalRead.entries : [];
      const additionalSourceId = await insertSecondarySource({
        database,
        expectedPrimarySourceId: existingSource.id,
        sourceType,
        sourceName,
        sourceTable,
        now,
      });
      // Snapshot membership IDs before importing so the new source binds only
      // its own rows without serializing the existing database.
      const priorItems = await getDb()
        .select({ documentId: schema.contentDatabaseItems.documentId })
        .from(schema.contentDatabaseItems)
        .where(eq(schema.contentDatabaseItems.databaseId, database.id));
      const priorDocumentIds = new Set(
        priorItems.map((item) => item.documentId),
      );
      let importedEntriesByDocumentId = new Map<
        string,
        BuilderCmsSourceEntry
      >();
      if (additionalRead.state === "live") {
        const importResult = await importBuilderCmsEntriesAsDatabaseItems({
          database,
          sourceId: additionalSourceId,
          entries: additionalEntries,
          now,
          sourceTable,
          existingSourceRows: [],
          skipTitleDedup: true,
        });
        importedEntriesByDocumentId = importResult.importedEntriesByDocumentId;
      }
      const importedDocumentIds = [...importedEntriesByDocumentId.keys()];
      const additionalSetup = await sourceSetupPayload(database.id, {
        documentIds: importedDocumentIds,
        limit: Math.max(1, importedDocumentIds.length),
        offset: 0,
      });
      // Only the items this collection just created — exclude the primary's.
      const importedItems = additionalSetup.response.items.filter(
        (item) => !priorDocumentIds.has(item.document.id),
      );
      const additionalEntriesByDocumentId =
        additionalRead.state === "live"
          ? mapBuilderCmsEntriesToLocalItems({
              entries: additionalEntries,
              items: importedItems,
              sourceTable,
              now,
              existingRows: [],
            })
          : undefined;
      for (const [documentId, entry] of importedEntriesByDocumentId) {
        additionalEntriesByDocumentId?.set(documentId, entry);
      }
      await seedMockSourceFields({
        sourceId: additionalSourceId,
        ownerEmail: database.ownerEmail,
        sourceType,
        properties: additionalSetup.properties,
        builderModelFields: additionalModelFields,
        builderSampleEntries: additionalEntries,
        now,
      });
      await seedMockSourceRows({
        sourceId: additionalSourceId,
        ownerEmail: database.ownerEmail,
        sourceType,
        sourceTable,
        items: importedItems,
        now,
        builderEntriesByDocumentId: additionalEntriesByDocumentId,
      });
      if (additionalRead.state === "live") {
        await enqueueBuilderBodyHydrationForItems({
          sourceId: additionalSourceId,
          ownerEmail: database.ownerEmail,
          orgId: database.orgId,
          sourceTable,
          items: importedItems,
          builderEntriesByDocumentId: additionalEntriesByDocumentId,
          now,
        });
      }
      await updateBuilderCmsSourceReadMetadata({
        sourceId: additionalSourceId,
        sourceTable,
        readState: additionalRead.state,
        entryCount: additionalRead.entries.length,
        matchedRowCount: additionalEntriesByDocumentId?.size ?? 0,
        fetchedAt: additionalRead.fetchedAt,
        now,
        message: additionalRead.message,
        builderModelFields: additionalModelFields,
        ...builderCmsAttachReadMetadata(additionalRead),
      });
      await ensureDatabaseSourceProperty({ database, now });

      return getContentDatabaseResponse(database.id, {
        limit: args.limit,
        offset: args.offset,
      });
    }

    if (relationshipMode === "items" && existingSource) {
      throw new Error(
        "Only Builder sources can add more items right now. Notion database sources are read-only detail sources in this pilot.",
      );
    }

    if (sourceType === "notion-database") {
      throw new Error(
        "Notion database sources are read-only detail sources in this pilot. Attach a local or Builder source first, then add Notion details with a match key.",
      );
    }

    const existingSourceRows = existingSource
      ? await getSourceRows(existingSource.id)
      : [];
    const builderInitial =
      sourceType === "builder-cms"
        ? await readCompleteBuilderCmsAttachSource(sourceTable, {
            fieldPaths: args.builderFieldPaths,
          })
        : null;
    const sourceId = await replaceSourceMetadata({
      database,
      source: existingSource,
      sourceType,
      sourceName,
      sourceTable,
      now,
    });
    const builderModelFields = builderInitial?.modelFields ?? [];
    const builderRead = builderInitial?.read ?? null;
    const builderPropertiesPromise = builderRead
      ? listPropertiesForDatabase(database.id)
      : null;
    const builderEntries =
      builderRead?.state === "live" ? builderRead.entries : [];
    let importedEntriesByDocumentId = new Map<string, BuilderCmsSourceEntry>();
    let importedItems: Awaited<
      ReturnType<typeof importBuilderCmsEntriesAsDatabaseItems>
    >["importedItems"] = [];
    if (builderRead?.state === "live") {
      const importResult = await importBuilderCmsEntriesAsDatabaseItems({
        database,
        sourceId,
        entries: builderEntries,
        now,
        sourceTable,
        existingSourceRows,
      });
      importedEntriesByDocumentId = importResult.importedEntriesByDocumentId;
      importedItems = importResult.importedItems;
    }
    const canUseImportedBuilderItems =
      builderRead?.state === "live" &&
      importedItems.length === builderRead.entries.length &&
      importedItems.length === importedEntriesByDocumentId.size;
    const refreshedSetup = canUseImportedBuilderItems
      ? null
      : await sourceSetupPayload(
          database.id,
          initialBuilderAttachmentSetupOptions({
            builderRead,
            importedEntriesByDocumentId,
          }),
        );
    const refreshedProperties =
      refreshedSetup?.properties ?? (await builderPropertiesPromise) ?? [];
    const refreshedItems = refreshedSetup?.response.items ?? importedItems;
    const builderEntriesByDocumentId =
      builderRead?.state === "live"
        ? mapBuilderCmsEntriesToLocalItems({
            entries: builderEntries,
            items: refreshedItems,
            sourceTable,
            now,
            existingRows: existingSourceRows,
          })
        : undefined;
    for (const [documentId, entry] of importedEntriesByDocumentId) {
      builderEntriesByDocumentId?.set(documentId, entry);
    }

    await (async () => {
      await seedMockSourceFields({
        sourceId,
        ownerEmail: database.ownerEmail,
        sourceType,
        properties: refreshedProperties,
        builderModelFields,
        builderSampleEntries: builderEntries,
        now,
      });
      await replaceMockSourceRows({
        sourceId,
        ownerEmail: database.ownerEmail,
        sourceType,
        sourceTable,
        items: refreshedItems,
        now,
        builderEntriesByDocumentId,
      });
      if (sourceType === "builder-cms" && builderRead?.state === "live") {
        await enqueueBuilderBodyHydrationForItems({
          sourceId,
          ownerEmail: database.ownerEmail,
          orgId: database.orgId,
          sourceTable,
          items: refreshedItems,
          builderEntriesByDocumentId,
          now,
          processInBackground: false,
        });
      }
      if (sourceType === "builder-cms" && builderRead) {
        await updateBuilderCmsSourceReadMetadata({
          sourceId,
          sourceTable,
          readState: builderRead.state,
          entryCount: builderRead.entries.length,
          matchedRowCount: builderEntriesByDocumentId?.size ?? 0,
          fetchedAt: builderRead.fetchedAt,
          now,
          message: builderRead.message,
          builderModelFields,
          ...builderCmsAttachReadMetadata(builderRead),
        });
      }
    })();
    if (sourceType === "builder-cms") {
      return {
        responseProjection: "ack",
        databaseId: database.id,
        documentId: database.documentId,
        sourceId,
        sourceType,
        sourceTable,
        importedItemCount: builderAttachDurableItemCount(
          builderEntriesByDocumentId,
        ),
        fetchedAt: builderRead?.fetchedAt ?? now,
      };
    }

    return getContentDatabaseResponse(database.id, {
      limit: args.limit,
      offset: args.offset,
    });
  },
});
