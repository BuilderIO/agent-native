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
  .enum([
    "mock-local",
    "builder-cms",
    "local-table",
    "local-folder",
    "github-url",
  ])
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
    "Attach or replace a mounted source binding for a content database. Builder CMS bindings can import rows and guarded write metadata; local-folder and github-url bindings require a real path or https://github.com/... URL and register repo-truth workspace scope without Git automation.",
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
      .describe(
        "Source table/model name. For local-folder, pass the folder path. For github-url, pass a https://github.com/... URL.",
      ),
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
      (sourceType === "builder-cms"
        ? "Builder CMS"
        : sourceType === "local-folder"
          ? "Local folder"
          : sourceType === "github-url"
            ? "GitHub URL"
            : "Mock local source");
    const sourceTable = args.sourceTable?.trim() || "";
    const resolvedSourceTable =
      sourceTable ||
      (sourceType === "builder-cms" ? "blog_article" : "content_items");
    if (
      (sourceType === "local-folder" || sourceType === "github-url") &&
      !sourceTable
    ) {
      throw new Error(
        sourceType === "local-folder"
          ? "Local folder sources require a folder path."
          : "GitHub URL sources require a https://github.com/... URL.",
      );
    }

    const existingSource = await getExistingSource(database.id);
    if (sourceType === "local-table") {
      if (resolvedSourceTable === database.id) {
        throw new Error("A database can't be added as a source of itself.");
      }
      await resolveReadableLocalTableSource(resolvedSourceTable);
    }
    if (sourceType === "github-url") {
      let parsed: URL | null = null;
      try {
        parsed = new URL(sourceTable);
      } catch {
        parsed = null;
      }
      if (
        !parsed ||
        parsed.protocol !== "https:" ||
        parsed.hostname !== "github.com"
      ) {
        throw new Error(
          "GitHub URL sources must be https://github.com/... URLs.",
        );
      }
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
      if (sourceType === "builder-cms") {
        const read = await readBuilderCmsContentEntries({
          model: resolvedSourceTable,
        });
        entries = read.state === "live" ? read.entries : [];
        modelFields = await readBuilderCmsModelFields({
          model: resolvedSourceTable,
        });
      } else if (sourceType === "local-table") {
        // sourceTable carries the target database id for a local-table source.
        ({ entries, modelFields } = await readLocalTableEntries(
          resolvedSourceTable,
          {
            limit: args.limit,
            offset: args.offset,
          },
        ));
      } else {
        entries = [];
        modelFields = [];
      }

      const secondaryId = await insertSecondarySource({
        database,
        sourceType,
        sourceName,
        sourceTable: resolvedSourceTable,
        now,
      });
      await storeSecondarySourceRows({
        sourceId: secondaryId,
        ownerEmail: database.ownerEmail,
        sourceType,
        sourceTable: resolvedSourceTable,
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
      if (
        await databaseSourceExistsForTable(database.id, resolvedSourceTable)
      ) {
        throw new Error(
          `"${resolvedSourceTable}" is already attached as a source.`,
        );
      }
      const additionalRead = await readBuilderCmsContentEntries({
        model: resolvedSourceTable,
      });
      const additionalEntries =
        additionalRead.state === "live" ? additionalRead.entries : [];
      const additionalModelFields = await readBuilderCmsModelFields({
        model: resolvedSourceTable,
      });
      const additionalSourceId = await insertSecondarySource({
        database,
        sourceType,
        sourceName,
        sourceTable: resolvedSourceTable,
        now,
      });
      // Snapshot existing items BEFORE importing so we can bind the new source
      // to ONLY the rows it imports — never the primary's existing rows.
      const beforeSetup = await sourceSetupPayload(database.id);
      const priorDocumentIds = new Set(
        beforeSetup.response.items.map((item) => item.document.id),
      );
      if (additionalRead.state === "live") {
        await importBuilderCmsEntriesAsDatabaseItems({
          database,
          entries: additionalEntries,
          now,
          sourceTable: resolvedSourceTable,
          existingSourceRows: [],
          skipTitleDedup: true,
        });
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
              sourceTable: resolvedSourceTable,
              now,
              existingRows: [],
            })
          : undefined;
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
        sourceTable: resolvedSourceTable,
        items: importedItems,
        now,
        builderEntriesByDocumentId: additionalEntriesByDocumentId,
      });
      if (additionalRead.state === "live") {
        await enqueueBuilderBodyHydrationForItems({
          sourceId: additionalSourceId,
          ownerEmail: database.ownerEmail,
          orgId: database.orgId,
          sourceTable: resolvedSourceTable,
          items: importedItems,
          builderEntriesByDocumentId: additionalEntriesByDocumentId,
          now,
        });
      }
      await updateBuilderCmsSourceReadMetadata({
        sourceId: additionalSourceId,
        sourceTable: resolvedSourceTable,
        readState: additionalRead.state,
        entryCount: additionalRead.entries.length,
        matchedRowCount: additionalEntriesByDocumentId?.size ?? 0,
        fetchedAt: additionalRead.fetchedAt,
        now,
        message: additionalRead.message,
        syncState: "linked",
      });
      await ensureDatabaseSourceProperty({ database, now });

      return getContentDatabaseResponse(database.id, {
        limit: args.limit,
        offset: args.offset,
      });
    }

    if (relationshipMode === "items" && existingSource) {
      if (sourceType !== "local-folder" && sourceType !== "github-url") {
        throw new Error(
          "Only Builder, local folder, or GitHub URL sources can add more items right now.",
        );
      }
      if (
        await databaseSourceExistsForTable(database.id, resolvedSourceTable)
      ) {
        throw new Error(
          `"${resolvedSourceTable}" is already attached as a source.`,
        );
      }
      const additionalSourceId = await insertSecondarySource({
        database,
        sourceType,
        sourceName,
        sourceTable: resolvedSourceTable,
        now,
      });
      const setup = await sourceSetupPayload(database.id);
      await seedMockSourceFields({
        sourceId: additionalSourceId,
        ownerEmail: database.ownerEmail,
        sourceType,
        properties: setup.properties,
        now,
      });
      await ensureDatabaseSourceProperty({ database, now });

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
      sourceTable: resolvedSourceTable,
      now,
    });
    const builderRead =
      sourceType === "builder-cms"
        ? await readBuilderCmsContentEntries({
            model: resolvedSourceTable,
          })
        : null;
    const builderEntries =
      builderRead?.state === "live" ? builderRead.entries : [];
    const builderModelFields =
      sourceType === "builder-cms"
        ? await readBuilderCmsModelFields({
            model: resolvedSourceTable,
          })
        : [];
    if (builderRead?.state === "live") {
      await importBuilderCmsEntriesAsDatabaseItems({
        database,
        entries: builderEntries,
        now,
        sourceTable: resolvedSourceTable,
        existingSourceRows,
      });
    }

    const refreshedSetup = await sourceSetupPayload(database.id);
    const builderEntriesByDocumentId =
      builderRead?.state === "live"
        ? mapBuilderCmsEntriesToLocalItems({
            entries: builderEntries,
            items: refreshedSetup.response.items,
            sourceTable: resolvedSourceTable,
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
      builderSampleEntries: builderEntries,
      now,
    });
    if (sourceType !== "local-folder" && sourceType !== "github-url") {
      await seedMockSourceRows({
        sourceId,
        ownerEmail: database.ownerEmail,
        sourceType,
        sourceTable: resolvedSourceTable,
        items: refreshedSetup.response.items,
        now,
        builderEntriesByDocumentId,
      });
    }
    if (sourceType === "builder-cms" && builderRead?.state === "live") {
      await enqueueBuilderBodyHydrationForItems({
        sourceId,
        ownerEmail: database.ownerEmail,
        orgId: database.orgId,
        sourceTable: resolvedSourceTable,
        items: refreshedSetup.response.items,
        builderEntriesByDocumentId,
        now,
      });
    }
    if (sourceType === "builder-cms" && builderRead) {
      await updateBuilderCmsSourceReadMetadata({
        sourceId,
        sourceTable: resolvedSourceTable,
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
