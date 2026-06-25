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
} from "./_builder-cms-read-client.js";
import type { BuilderCmsSourceEntry } from "./_builder-cms-source-adapter.js";
import {
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
    join: joinSchema
      .optional()
      .describe(
        "When adding a SECOND source, the canonical-key join that federates it onto the primary (read-only overlay).",
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

    // Adding a SECOND source: federate it onto the primary on the canonical key
    // instead of replacing the binding. Read-only overlay — the secondary's
    // entries are NOT imported as local documents/items.
    if (args.join && existingSource) {
      let entries: BuilderCmsSourceEntry[];
      let modelFields: BuilderCmsModelFieldSummary[];
      if (sourceType === "builder-cms") {
        const read = await readBuilderCmsContentEntries({ model: sourceTable });
        entries = read.state === "live" ? read.entries : [];
        modelFields = await readBuilderCmsModelFields({ model: sourceTable });
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

    const existingSourceRows = existingSource
      ? await getSourceRows(existingSource.id)
      : [];
    const sourceId = await replaceSourceMetadata({
      database,
      source: existingSource,
      sourceType,
      sourceName,
      sourceTable,
      now,
    });
    const builderRead =
      sourceType === "builder-cms"
        ? await readBuilderCmsContentEntries({
            model: sourceTable,
          })
        : null;
    const builderModelFields =
      sourceType === "builder-cms"
        ? await readBuilderCmsModelFields({
            model: sourceTable,
          })
        : [];
    if (builderRead?.state === "live") {
      await importBuilderCmsEntriesAsDatabaseItems({
        database,
        entries: builderRead.entries,
        now,
        sourceTable,
        existingSourceRows,
      });
    }

    const refreshedSetup = await sourceSetupPayload(database.id);
    const builderEntriesByDocumentId =
      builderRead?.state === "live"
        ? mapBuilderCmsEntriesToLocalItems({
            entries: builderRead.entries,
            items: refreshedSetup.response.items,
            sourceTable,
            now,
            existingRows: existingSourceRows,
          })
        : undefined;

    await seedMockSourceFields({
      sourceId,
      ownerEmail: database.ownerEmail,
      sourceType,
      properties: refreshedSetup.properties,
      builderModelFields,
      builderSampleEntries:
        builderRead?.state === "live" ? builderRead.entries : [],
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
        syncState: "linked",
      });
    }

    return getContentDatabaseResponse(database.id, {
      limit: args.limit,
      offset: args.offset,
    });
  },
});
