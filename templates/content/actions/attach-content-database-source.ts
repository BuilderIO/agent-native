import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import type {
  BuilderCmsModelFieldSummary,
  ContentDatabaseResponse,
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
import {
  databaseSourceExistsForTable,
  enqueueBuilderBodyHydrationForItems,
  ensureDatabaseSourceProperty,
  getExistingSource,
  getSourceRows,
  importBuilderCmsEntriesAsDatabaseItems,
  insertSecondarySource,
  mapBuilderCmsEntriesToLocalItems,
  replaceSourceMetadata,
  resolveDatabaseForSourceMutation,
  seedMockSourceFields,
  seedMockSourceRows,
  seedSecondarySourceFields,
  sourceSetupPayload,
  storeSecondarySourceRows,
  updateBuilderCmsSourceReadMetadata,
  writeSourceFederation,
} from "./_database-source-utils.js";
import { getContentDatabaseResponse } from "./_database-utils.js";
import {
  readLocalTableEntries,
  resolveReadableLocalTableSource,
} from "./_local-table-source.js";

const sourceTypeSchema = z
  .enum(["mock-local", "builder-cms", "local-table"])
  .default("mock-local");
const BUILDER_CMS_ATTACH_INITIAL_PAGES = 1;

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
  } = {},
) {
  const readModelFields =
    dependencies.readModelFields ?? readBuilderCmsModelFields;
  const readEntries = dependencies.readEntries ?? readBuilderCmsContentEntries;
  let modelFields: BuilderCmsModelFieldSummary[] = [];
  let modelFieldsError: unknown = null;
  try {
    modelFields = await readModelFields({ model: sourceTable });
  } catch (error) {
    modelFieldsError = error;
  }
  const read = await readInitialBuilderCmsAttachEntries(
    sourceTable,
    readEntries,
    modelFields.map((field) => `data.${field.name}`),
  );
  if (modelFieldsError) throw modelFieldsError;
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
  run: async (args): Promise<ContentDatabaseResponse> => {
    const database = await resolveDatabaseForSourceMutation(args);
    if (!database) throw new Error("Database not found.");
    await assertAccess("document", database.documentId, "editor");

    const now = new Date().toISOString();
    const sourceType = (args.sourceType ??
      "mock-local") as ContentDatabaseSourceType;
    const sourceName =
      args.sourceName?.trim() ||
      (sourceType === "builder-cms" ? "Builder CMS" : "Mock local source");
    const sourceTable =
      args.sourceTable?.trim() ||
      (sourceType === "builder-cms" ? "blog_article" : "content_items");

    const existingSource = await getExistingSource(database.id);
    if (sourceType === "local-table") {
      if (sourceTable === database.id) {
        throw new Error("A database can't be added as a source of itself.");
      }
      await resolveReadableLocalTableSource(sourceTable);
    }

    const relationshipMode =
      args.relationshipMode ?? (args.mode === "add" ? "items" : undefined);

    // Adding a SECOND source as details: relate it onto the primary on the
    // canonical key. Read-only overlay — the secondary's entries are NOT
    // imported as local documents/items.
    if ((relationshipMode === "details" || args.join) && existingSource) {
      if (!args.join) {
        throw new Error("Choose a match key before adding source details.");
      }
      let entries: BuilderCmsSourceEntry[];
      let modelFields: BuilderCmsModelFieldSummary[];
      let builderRead: BuilderCmsReadResult | null = null;
      if (sourceType === "builder-cms") {
        const initial = await readInitialBuilderCmsAttachSource(sourceTable);
        modelFields = initial.modelFields;
        builderRead = initial.read;
        entries = builderRead.state === "live" ? builderRead.entries : [];
      } else if (sourceType === "local-table") {
        // sourceTable carries the target database id for a local-table source.
        ({ entries, modelFields } = await readLocalTableEntries(sourceTable, {
          limit: args.limit,
          offset: args.offset,
        }));
      } else {
        entries = [];
        modelFields = [];
      }

      const secondaryId = await insertSecondarySource({
        database,
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
        sourceType,
        sourceName,
        sourceTable,
        now,
      });
      // Snapshot existing items BEFORE importing so we can bind the new source
      // to ONLY the rows it imports — never the primary's existing rows.
      const beforeSetup = await sourceSetupPayload(database.id);
      const priorDocumentIds = new Set(
        beforeSetup.response.items.map((item) => item.document.id),
      );
      let importedEntriesByDocumentId = new Map<
        string,
        BuilderCmsSourceEntry
      >();
      if (additionalRead.state === "live") {
        const importResult = await importBuilderCmsEntriesAsDatabaseItems({
          database,
          entries: additionalEntries,
          now,
          sourceTable,
          existingSourceRows: [],
          skipTitleDedup: true,
        });
        importedEntriesByDocumentId = importResult.importedEntriesByDocumentId;
      }
      const additionalSetup = await sourceSetupPayload(database.id);
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
      throw new Error("Only Builder sources can add more items right now.");
    }

    const existingSourceRows = existingSource
      ? await getSourceRows(existingSource.id)
      : [];
    const builderInitial =
      sourceType === "builder-cms"
        ? await readInitialBuilderCmsAttachSource(sourceTable)
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
    const builderEntries =
      builderRead?.state === "live" ? builderRead.entries : [];
    let importedEntriesByDocumentId = new Map<string, BuilderCmsSourceEntry>();
    if (builderRead?.state === "live") {
      const importResult = await importBuilderCmsEntriesAsDatabaseItems({
        database,
        entries: builderEntries,
        now,
        sourceTable,
        existingSourceRows,
      });
      importedEntriesByDocumentId = importResult.importedEntriesByDocumentId;
    }

    const refreshedSetup = await sourceSetupPayload(database.id);
    const builderEntriesByDocumentId =
      builderRead?.state === "live"
        ? mapBuilderCmsEntriesToLocalItems({
            entries: builderEntries,
            items: refreshedSetup.response.items,
            sourceTable,
            now,
            existingRows: existingSourceRows,
          })
        : undefined;
    for (const [documentId, entry] of importedEntriesByDocumentId) {
      builderEntriesByDocumentId?.set(documentId, entry);
    }

    await seedMockSourceFields({
      sourceId,
      ownerEmail: database.ownerEmail,
      sourceType,
      properties: refreshedSetup.properties,
      builderModelFields,
      builderSampleEntries: builderEntries,
      now,
    });
    await seedMockSourceRows({
      sourceId,
      ownerEmail: database.ownerEmail,
      sourceType,
      sourceTable,
      items: refreshedSetup.response.items,
      now,
      builderEntriesByDocumentId,
    });
    if (sourceType === "builder-cms" && builderRead?.state === "live") {
      await enqueueBuilderBodyHydrationForItems({
        sourceId,
        ownerEmail: database.ownerEmail,
        orgId: database.orgId,
        sourceTable,
        items: refreshedSetup.response.items,
        builderEntriesByDocumentId,
        now,
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

    return getContentDatabaseResponse(database.id, {
      limit: args.limit,
      offset: args.offset,
    });
  },
});
