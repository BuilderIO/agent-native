import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
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
import { getContentDatabaseSourceAdapter } from "./_content-database-source-adapters.js";
import {
  enqueueBuilderBodyHydrationForItems,
  ensureDatabaseSourceProperty,
  importBuilderCmsEntriesAsDatabaseItems,
  mapBuilderCmsEntriesToLocalItems,
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
import { readLocalTableEntries } from "./_local-table-source.js";

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

type SourceRecord = typeof schema.contentDatabaseSources.$inferSelect;

function identityFederation(
  role: "primary" | "secondary",
  side: z.infer<typeof joinSideSchema>,
  canonicalKey: {
    propertyId?: string | null;
    label: string;
    type?: string;
  },
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

function sourceType(value: string): ContentDatabaseSourceType {
  if (
    value === "builder-cms" ||
    value === "local-table" ||
    value === "notion-database"
  )
    return value;
  return "mock-local";
}

function sourceRole(source: SourceRecord): "primary" | "secondary" | null {
  try {
    const parsed = JSON.parse(source.metadataJson ?? "{}") as {
      federation?: { role?: string };
    };
    return parsed.federation?.role === "primary" ||
      parsed.federation?.role === "secondary"
      ? parsed.federation.role
      : null;
  } catch {
    return null;
  }
}

async function clearSourceFederation(sourceId: string, now: string) {
  const db = getDb();
  const [current] = await db
    .select({ metadataJson: schema.contentDatabaseSources.metadataJson })
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, sourceId));
  let metadata: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(current?.metadataJson ?? "{}") as unknown;
    metadata =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
  } catch {
    metadata = {};
  }
  delete metadata.federation;
  await db
    .update(schema.contentDatabaseSources)
    .set({ metadataJson: JSON.stringify(metadata), updatedAt: now })
    .where(eq(schema.contentDatabaseSources.id, sourceId));
}

async function removeRowsOwnedOnlyBySource(args: {
  databaseId: string;
  sourceId: string;
}) {
  const db = getDb();
  const [targetRows, otherRows] = await Promise.all([
    db
      .select()
      .from(schema.contentDatabaseSourceRows)
      .where(eq(schema.contentDatabaseSourceRows.sourceId, args.sourceId)),
    db
      .select()
      .from(schema.contentDatabaseSourceRows)
      .where(ne(schema.contentDatabaseSourceRows.sourceId, args.sourceId)),
  ]);
  const otherDocumentIds = new Set(
    otherRows.map((row) => row.documentId).filter(Boolean),
  );
  const itemIds = targetRows
    .filter(
      (row) =>
        row.databaseItemId &&
        row.documentId &&
        !otherDocumentIds.has(row.documentId),
    )
    .map((row) => row.databaseItemId);
  if (itemIds.length === 0) return;
  await db
    .delete(schema.contentDatabaseItems)
    .where(
      and(
        eq(schema.contentDatabaseItems.databaseId, args.databaseId),
        inArray(schema.contentDatabaseItems.id, itemIds),
      ),
    );
}

export async function readBuilderCmsEntriesForRoleChange(
  args: {
    model: string;
    existingFieldPaths?: readonly string[];
  },
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
    modelFields = await readModelFields({ model: args.model });
  } catch (error) {
    modelFieldsError = error;
  }
  const read = await readEntries({
    model: args.model,
    fieldPaths: [
      ...(args.existingFieldPaths ?? []),
      ...modelFields.map((field) => `data.${field.name}`),
    ],
  });
  if (modelFieldsError) throw modelFieldsError;
  return { read, modelFields };
}

async function readSourceEntries(args: {
  sourceType: ContentDatabaseSourceType;
  sourceTable: string;
  limit: number;
  offset: number;
}): Promise<{
  entries: BuilderCmsSourceEntry[];
  modelFields: BuilderCmsModelFieldSummary[];
  readState: "live" | "unconfigured" | "error" | null;
  fetchedAt: string | null;
  message: string | null;
}> {
  if (args.sourceType === "builder-cms") {
    const { read, modelFields } = await readBuilderCmsEntriesForRoleChange({
      model: args.sourceTable,
    });
    return {
      entries: read.state === "live" ? read.entries : [],
      modelFields,
      readState: read.state,
      fetchedAt: read.fetchedAt,
      message: read.message,
    };
  }
  if (args.sourceType === "local-table") {
    const { entries, modelFields } = await readLocalTableEntries(
      args.sourceTable,
      { limit: args.limit, offset: args.offset },
    );
    return {
      entries,
      modelFields,
      readState: null,
      fetchedAt: null,
      message: null,
    };
  }
  if (args.sourceType === "notion-database") {
    const read = await getContentDatabaseSourceAdapter("notion-database")!.read(
      {
        sourceTable: args.sourceTable,
        limit: args.limit,
        offset: args.offset,
      },
    );
    return {
      entries: read.entries,
      modelFields: read.fields,
      readState: read.state,
      fetchedAt: read.fetchedAt,
      message: read.message,
    };
  }
  return {
    entries: [],
    modelFields: [],
    readState: null,
    fetchedAt: null,
    message: null,
  };
}

export default defineAction({
  description:
    "Change how an attached content database source participates: add more item rows, or add details to existing rows through a confirmed match key.",
  schema: z.object({
    databaseId: z.string().optional().describe("Database ID"),
    documentId: z.string().optional().describe("Database document/page ID"),
    sourceId: z.string().describe("Attached source ID to change."),
    relationshipMode: z
      .enum(["items", "details"])
      .describe("items adds rows; details joins fields onto existing rows."),
    join: joinSchema
      .optional()
      .describe("Required when changing a source to add details."),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  }),
  run: async (args): Promise<ContentDatabaseResponse> => {
    const database = await resolveDatabaseForSourceMutation(args);
    if (!database) throw new Error("Database not found.");
    await assertAccess("document", database.documentId, "editor");

    const db = getDb();
    const now = new Date().toISOString();
    const sources = await db
      .select()
      .from(schema.contentDatabaseSources)
      .where(eq(schema.contentDatabaseSources.databaseId, database.id))
      .orderBy(asc(schema.contentDatabaseSources.createdAt));
    const source = sources.find((item) => item.id === args.sourceId) ?? null;
    if (!source) throw new Error("Source not found.");

    const normalizedType = sourceType(source.sourceType);

    if (args.relationshipMode === "details") {
      if (!args.join) {
        throw new Error("Choose a match key before adding source details.");
      }
      const primary =
        sources.find(
          (item) => item.id !== source.id && sourceRole(item) !== "secondary",
        ) ?? null;
      if (!primary) {
        throw new Error("Add an item source before adding source details.");
      }

      const { entries, modelFields } = await readSourceEntries({
        sourceType: normalizedType,
        sourceTable: source.sourceTable,
        limit: args.limit ?? 100,
        offset: args.offset ?? 0,
      });
      await removeRowsOwnedOnlyBySource({
        databaseId: database.id,
        sourceId: source.id,
      });
      await storeSecondarySourceRows({
        sourceId: source.id,
        ownerEmail: database.ownerEmail,
        sourceType: normalizedType,
        sourceTable: source.sourceTable,
        entries,
        now,
      });
      await seedSecondarySourceFields({
        sourceId: source.id,
        ownerEmail: database.ownerEmail,
        sourceType: normalizedType,
        modelFields,
        sampleEntry: entries[0],
        now,
      });
      await writeSourceFederation({
        sourceId: source.id,
        federation: identityFederation(
          "secondary",
          args.join.secondary,
          args.join.canonicalKey,
          args.join.columnBindings,
        ),
        now,
      });
      await writeSourceFederation({
        sourceId: primary.id,
        federation: identityFederation(
          "primary",
          args.join.primary,
          args.join.canonicalKey,
        ),
        now,
      });
      await ensureDatabaseSourceProperty({ database, now });
    } else {
      if (normalizedType !== "builder-cms") {
        throw new Error("Only Builder sources can add more items right now.");
      }

      const existingSourceFields = await db
        .select({
          sourceFieldKey: schema.contentDatabaseSourceFields.sourceFieldKey,
        })
        .from(schema.contentDatabaseSourceFields)
        .where(eq(schema.contentDatabaseSourceFields.sourceId, source.id));
      const { read, modelFields: builderModelFields } =
        await readBuilderCmsEntriesForRoleChange({
          model: source.sourceTable,
          existingFieldPaths: existingSourceFields.map(
            (field) => field.sourceFieldKey,
          ),
        });
      const entries = read.state === "live" ? read.entries : [];
      await db
        .delete(schema.contentDatabaseSourceFields)
        .where(eq(schema.contentDatabaseSourceFields.sourceId, source.id));
      await db
        .delete(schema.contentDatabaseSourceRows)
        .where(eq(schema.contentDatabaseSourceRows.sourceId, source.id));
      await clearSourceFederation(source.id, now);

      let importedEntriesByDocumentId = new Map<
        string,
        BuilderCmsSourceEntry
      >();
      if (read.state === "live") {
        const importResult = await importBuilderCmsEntriesAsDatabaseItems({
          database,
          entries,
          now,
          sourceTable: source.sourceTable,
          existingSourceRows: [],
          skipTitleDedup: true,
        });
        importedEntriesByDocumentId = importResult.importedEntriesByDocumentId;
      }
      const refreshedSetup = await sourceSetupPayload(database.id);
      const builderEntriesByDocumentId =
        read.state === "live"
          ? mapBuilderCmsEntriesToLocalItems({
              entries,
              items: refreshedSetup.response.items,
              sourceTable: source.sourceTable,
              now,
              existingRows: [],
            })
          : new Map<string, BuilderCmsSourceEntry>();
      for (const [documentId, entry] of importedEntriesByDocumentId) {
        builderEntriesByDocumentId.set(documentId, entry);
      }
      await seedMockSourceFields({
        sourceId: source.id,
        ownerEmail: database.ownerEmail,
        sourceType: "builder-cms",
        properties: refreshedSetup.properties,
        builderModelFields,
        builderSampleEntries: entries,
        now,
      });
      await seedMockSourceRows({
        sourceId: source.id,
        ownerEmail: database.ownerEmail,
        sourceType: "builder-cms",
        sourceTable: source.sourceTable,
        items: refreshedSetup.response.items.filter((item) =>
          builderEntriesByDocumentId.has(item.document.id),
        ),
        now,
        builderEntriesByDocumentId,
      });
      if (read.state === "live") {
        await enqueueBuilderBodyHydrationForItems({
          sourceId: source.id,
          ownerEmail: database.ownerEmail,
          orgId: database.orgId,
          sourceTable: source.sourceTable,
          items: refreshedSetup.response.items.filter((item) =>
            builderEntriesByDocumentId.has(item.document.id),
          ),
          builderEntriesByDocumentId,
          now,
        });
      }
      await updateBuilderCmsSourceReadMetadata({
        sourceId: source.id,
        sourceTable: source.sourceTable,
        readState: read.state,
        entryCount: entries.length,
        matchedRowCount: builderEntriesByDocumentId.size,
        fetchedAt: read.fetchedAt,
        now,
        message: read.message,
        syncState: "linked",
        builderModelFields,
      });

      const latestSources = await db
        .select()
        .from(schema.contentDatabaseSources)
        .where(eq(schema.contentDatabaseSources.databaseId, database.id));
      const hasOtherDetails = latestSources.some(
        (item) => item.id !== source.id && sourceRole(item) === "secondary",
      );
      if (!hasOtherDetails) {
        for (const item of latestSources) {
          if (sourceRole(item) === "primary") {
            await clearSourceFederation(item.id, now);
          }
        }
      }
      await ensureDatabaseSourceProperty({ database, now });
    }

    return getContentDatabaseResponse(database.id, {
      limit: args.limit ?? 100,
      offset: args.offset ?? 0,
    });
  },
});
