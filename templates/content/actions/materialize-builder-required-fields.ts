import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  BUILDER_CMS_SAFE_WRITE_MODEL,
  type BuilderCmsModelFieldSummary,
  type DocumentPropertyValue,
} from "../shared/api.js";
import {
  normalizePropertyVisibility,
  serializePropertyOptions,
  serializePropertyValue,
  type DocumentPropertyOptionColor,
  type DocumentPropertyOptions,
  type DocumentPropertyType,
} from "../shared/properties.js";
import { chunks } from "./_batch-utils.js";
import { readBuilderCmsContentEntries } from "./_builder-cms-read-client.js";
import {
  builderReferenceIdSourceValueKey,
  resolveDatabaseForSourceMutation,
} from "./_database-source-utils.js";
import { getContentDatabaseResponse } from "./_database-utils.js";
import { nanoid } from "./_property-utils.js";
import {
  propertyTypeForSourceField,
  sourceFieldPropertyOptions,
  sourceFieldPropertyValuesFromRows,
} from "./add-content-database-source-field-property.js";

const REFERENCE_TYPE = "reference";
const FILE_TYPE = "file";
const OMITTED_BODY_FIELDS = new Set(["blocks", "blocksString"]);
const OPTION_COLORS: DocumentPropertyOptionColor[] = [
  "blue",
  "green",
  "purple",
  "pink",
  "orange",
  "yellow",
  "red",
  "gray",
];

type SourceRow = typeof schema.contentDatabaseSourceRows.$inferSelect;
type SourceField = typeof schema.contentDatabaseSourceFields.$inferSelect;

function parseMetadata(value: string | null) {
  if (!value)
    return {} as { builderModelFields?: BuilderCmsModelFieldSummary[] };
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as { builderModelFields?: BuilderCmsModelFieldSummary[] })
      : {};
  } catch {
    return {};
  }
}

function parseSourceValues(value: string | null | undefined) {
  if (!value) return {} as Record<string, DocumentPropertyValue>;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, DocumentPropertyValue>)
      : {};
  } catch {
    return {};
  }
}

function requiredFieldKey(field: BuilderCmsModelFieldSummary) {
  return `data.${field.name.trim()}`;
}

export function isRequiredEditableBuilderField(
  field: BuilderCmsModelFieldSummary,
) {
  const name = field.name.trim();
  return (
    field.required === true &&
    name.length > 0 &&
    name !== "title" &&
    !OMITTED_BODY_FIELDS.has(name)
  );
}

export function propertyTypeForRequiredBuilderField(
  field: SourceField,
  metadata: BuilderCmsModelFieldSummary,
): DocumentPropertyType {
  const normalized = field.sourceFieldType.trim().toLowerCase();
  if (isBuilderReferenceModelField(metadata) || normalized === REFERENCE_TYPE)
    return "select";
  if (normalized === FILE_TYPE) return "files_media";
  return propertyTypeForSourceField(field.sourceFieldType, metadata);
}

/**
 * Builder's model schema is authoritative for provider-native value shape.
 * The projected source field type can be `select` because Content renders
 * references with a select editor, including on sources created before raw
 * reference metadata was available.
 */
export function isBuilderReferenceModelField(
  field: BuilderCmsModelFieldSummary,
) {
  return [field.type, field.inputType]
    .filter((value): value is string => typeof value === "string")
    .some((value) => /\b(reference|relation)\b/i.test(value));
}

function rawReference(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record["@type"] !== "@builder.io/core:Reference" ||
    typeof record.id !== "string" ||
    !record.id.trim()
  ) {
    return null;
  }
  return {
    id: record.id.trim(),
    model:
      typeof record.model === "string" && record.model.trim()
        ? record.model.trim()
        : null,
  };
}

type ReferenceSnapshot = {
  bySourceRowId: Map<string, { id: string; model: string; label: string }>;
  options: DocumentPropertyOptions;
  model: string;
};

export async function readBuilderReferenceSnapshot(args: {
  sourceTable: string;
  field: BuilderCmsModelFieldSummary;
  visibleValueBySourceRowId?: ReadonlyMap<string, unknown>;
  readEntries?: typeof readBuilderCmsContentEntries;
}): Promise<ReferenceSnapshot> {
  const sourceFieldKey = requiredFieldKey(args.field);
  const read = await (args.readEntries ?? readBuilderCmsContentEntries)({
    model: args.sourceTable,
    fieldPaths: [sourceFieldKey],
    rawData: true,
    requirePrivateKey: true,
    limit: 10_000,
    maxPages: 100,
  });
  if (read.state !== "live" || read.progress.partial || read.progress.hasMore) {
    throw new Error(
      `Builder reference choices for ${args.field.label ?? args.field.name} could not be read exhaustively. No fields were added.`,
    );
  }

  const bySourceRowId = new Map<
    string,
    { id: string; model: string; label: string }
  >();
  const choiceById = new Map<
    string,
    { id: string; model: string; label: string }
  >();
  for (const entry of read.entries) {
    const data = entry.rawEntry?.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) continue;
    const reference = rawReference(
      (data as Record<string, unknown>)[args.field.name],
    );
    if (!reference) continue;
    const model = reference.model ?? args.field.model;
    if (!model) {
      throw new Error(
        `Builder reference field ${args.field.label ?? args.field.name} has no target model. No fields were added.`,
      );
    }
    // The raw reference read is authoritative for the Builder-native id, but
    // its projected display value can be absent or reduced to `model:id`.
    // Prefer the already-synced row label so the local select option and the
    // source baseline normalize to the same id immediately after setup.
    const storedVisible = args.visibleValueBySourceRowId?.get(entry.id);
    const visible =
      typeof storedVisible === "string" && storedVisible.trim()
        ? storedVisible
        : entry.sourceValues[sourceFieldKey];
    const label =
      typeof visible === "string" && visible.trim()
        ? visible.trim()
        : `${model}:${reference.id.slice(0, 8)}`;
    const choice = { id: reference.id, model, label };
    bySourceRowId.set(entry.id, choice);
    choiceById.set(reference.id, choice);
  }
  if (choiceById.size === 0) {
    throw new Error(
      `Builder reference field ${args.field.label ?? args.field.name} has no usable choices. No fields were added.`,
    );
  }
  const models = new Set(
    Array.from(choiceById.values(), (choice) => choice.model),
  );
  if (models.size !== 1) {
    throw new Error(
      `Builder reference field ${args.field.label ?? args.field.name} points to more than one model. No fields were added.`,
    );
  }

  const labelCounts = new Map<string, number>();
  for (const choice of choiceById.values()) {
    const key = choice.label.toLowerCase();
    labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
  }
  return {
    bySourceRowId,
    model: models.values().next().value!,
    options: {
      options: Array.from(choiceById.values())
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((choice, index) => ({
          id: choice.id,
          name:
            (labelCounts.get(choice.label.toLowerCase()) ?? 0) > 1
              ? `${choice.label} · ${choice.id.slice(0, 8)}`
              : choice.label,
          color: OPTION_COLORS[index % OPTION_COLORS.length]!,
        })),
    },
  };
}

export function referenceItemValues(args: {
  rows: SourceRow[];
  snapshot: ReferenceSnapshot;
  existingDocumentIds?: ReadonlySet<string>;
}) {
  return args.rows.flatMap((row) => {
    if (args.existingDocumentIds?.has(row.documentId)) return [];
    const choice = args.snapshot.bySourceRowId.get(row.sourceRowId);
    return choice
      ? [
          {
            itemId: row.databaseItemId,
            documentId: row.documentId,
            value: choice.id as DocumentPropertyValue,
          },
        ]
      : [];
  });
}

export default defineAction({
  description:
    "Materialize every required Builder field as an editable Content property for the safe Builder test model in one atomic local mutation.",
  agentTool: false,
  schema: z.object({
    databaseId: z.string().optional(),
    documentId: z.string().optional(),
    sourceId: z.string().optional(),
  }),
  run: async (args) => {
    const database = await resolveDatabaseForSourceMutation(args);
    if (!database) throw new Error("Database not found.");
    await assertAccess("document", database.documentId, "editor");
    const db = getDb();
    const sourceFilters = [
      eq(schema.contentDatabaseSources.databaseId, database.id),
      eq(
        schema.contentDatabaseSources.sourceTable,
        BUILDER_CMS_SAFE_WRITE_MODEL,
      ),
      eq(schema.contentDatabaseSources.sourceType, "builder-cms"),
    ];
    if (args.sourceId) {
      sourceFilters.push(eq(schema.contentDatabaseSources.id, args.sourceId));
    }
    const [source] = await db
      .select()
      .from(schema.contentDatabaseSources)
      .where(and(...sourceFilters));
    if (!source) {
      throw new Error(
        `Required-field setup is available only for ${BUILDER_CMS_SAFE_WRITE_MODEL}.`,
      );
    }

    const modelFields =
      parseMetadata(source.metadataJson).builderModelFields ?? [];
    const requiredModelFields = modelFields.filter(
      isRequiredEditableBuilderField,
    );
    if (requiredModelFields.length === 0) {
      throw new Error(
        "Builder did not provide required-field metadata. Refresh the safe source and try again.",
      );
    }
    const [fieldRows, sourceRows] = await Promise.all([
      db
        .select()
        .from(schema.contentDatabaseSourceFields)
        .where(eq(schema.contentDatabaseSourceFields.sourceId, source.id)),
      db
        .select()
        .from(schema.contentDatabaseSourceRows)
        .where(eq(schema.contentDatabaseSourceRows.sourceId, source.id)),
    ]);
    const fieldByKey = new Map(
      fieldRows.map((field) => [field.sourceFieldKey, field]),
    );
    const referenceSnapshots = new Map<string, ReferenceSnapshot>();
    // Reference snapshots also repair already-materialized mappings. Existing
    // property values are canonical Builder ids and must never be overwritten;
    // reruns only correct option labels and seed rows that still have no value.
    for (const metadata of requiredModelFields) {
      const field = fieldByKey.get(requiredFieldKey(metadata));
      if (!field || !isBuilderReferenceModelField(metadata)) continue;
      referenceSnapshots.set(
        field.sourceFieldKey,
        await readBuilderReferenceSnapshot({
          sourceTable: source.sourceTable,
          field: metadata,
          visibleValueBySourceRowId: new Map(
            sourceRows.map((row) => [
              row.sourceRowId,
              parseSourceValues(row.sourceValuesJson)[field.sourceFieldKey],
            ]),
          ),
        }),
      );
    }
    const enrichedModelFields = modelFields.map((field) => {
      const reference = referenceSnapshots.get(requiredFieldKey(field));
      return reference && !field.model
        ? { ...field, model: reference.model }
        : field;
    });
    const enrichedMetadataJson = JSON.stringify({
      ...parseMetadata(source.metadataJson),
      builderModelFields: enrichedModelFields,
    });

    await db.transaction(async (tx) => {
      const currentFields = await tx
        .select()
        .from(schema.contentDatabaseSourceFields)
        .where(eq(schema.contentDatabaseSourceFields.sourceId, source.id));
      const currentByKey = new Map(
        currentFields.map((field) => [field.sourceFieldKey, field]),
      );
      const currentSourceRows = await tx
        .select()
        .from(schema.contentDatabaseSourceRows)
        .where(eq(schema.contentDatabaseSourceRows.sourceId, source.id));
      const [maxPosition] = await tx
        .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
        .from(schema.documentPropertyDefinitions)
        .where(
          and(
            eq(
              schema.documentPropertyDefinitions.ownerEmail,
              database.ownerEmail,
            ),
            eq(schema.documentPropertyDefinitions.databaseId, database.id),
          ),
        );
      let position = maxPosition?.max ?? -1;
      const now = new Date().toISOString();
      const canonicalSourceRows = currentSourceRows.flatMap((row) => {
        const sourceValues = parseSourceValues(row.sourceValuesJson);
        let changed = false;
        for (const [sourceFieldKey, snapshot] of referenceSnapshots) {
          const choice = snapshot.bySourceRowId.get(row.sourceRowId);
          if (!choice) continue;
          const referenceIdKey =
            builderReferenceIdSourceValueKey(sourceFieldKey);
          if (sourceValues[referenceIdKey] === choice.id) continue;
          sourceValues[referenceIdKey] = choice.id;
          changed = true;
        }
        return changed
          ? [
              {
                ...row,
                sourceValuesJson: JSON.stringify(sourceValues),
                updatedAt: now,
              },
            ]
          : [];
      });
      for (const batch of chunks(canonicalSourceRows, 5)) {
        await tx
          .insert(schema.contentDatabaseSourceRows)
          .values(batch)
          .onConflictDoUpdate({
            target: schema.contentDatabaseSourceRows.id,
            set: {
              sourceValuesJson: sql`excluded.source_values_json`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
      }
      for (const metadata of requiredModelFields) {
        const field = currentByKey.get(requiredFieldKey(metadata));
        if (!field) {
          throw new Error(
            `Required Builder field ${metadata.label ?? metadata.name} is missing from the source mapping. No fields were added.`,
          );
        }
        const reference = referenceSnapshots.get(field.sourceFieldKey);
        if (field.propertyId) {
          if (!reference) continue;
          const [property] = await tx
            .select()
            .from(schema.documentPropertyDefinitions)
            .where(
              and(
                eq(schema.documentPropertyDefinitions.id, field.propertyId),
                eq(schema.documentPropertyDefinitions.databaseId, database.id),
                eq(
                  schema.documentPropertyDefinitions.ownerEmail,
                  database.ownerEmail,
                ),
              ),
            );
          if (!property || property.type !== "select") {
            throw new Error(
              `Required Builder reference field ${field.sourceFieldLabel} is not bound to a valid select property. No fields were repaired.`,
            );
          }
          const repairedOptionsJson = serializePropertyOptions(
            reference.options,
          );
          if (property.optionsJson !== repairedOptionsJson) {
            await tx
              .update(schema.documentPropertyDefinitions)
              .set({ optionsJson: repairedOptionsJson, updatedAt: now })
              .where(eq(schema.documentPropertyDefinitions.id, property.id));
          }
          const existingValues = await tx
            .select({ documentId: schema.documentPropertyValues.documentId })
            .from(schema.documentPropertyValues)
            .where(
              eq(schema.documentPropertyValues.propertyId, field.propertyId),
            );
          const missingItemValues = referenceItemValues({
            rows: currentSourceRows,
            snapshot: reference,
            existingDocumentIds: new Set(
              existingValues.map((value) => value.documentId),
            ),
          });
          for (const batch of chunks(missingItemValues, 200)) {
            await tx.insert(schema.documentPropertyValues).values(
              batch.map((item) => ({
                id: nanoid(),
                ownerEmail: database.ownerEmail,
                documentId: item.documentId,
                propertyId: field.propertyId!,
                valueJson: serializePropertyValue(item.value),
                createdAt: now,
                updatedAt: now,
              })),
            );
          }
          continue;
        }
        const type = propertyTypeForRequiredBuilderField(field, metadata);
        const options = reference
          ? reference.options
          : sourceFieldPropertyOptions({
              type,
              metadata,
              rows: currentSourceRows,
              sourceFieldKey: field.sourceFieldKey,
            });
        const propertyId = nanoid();
        position += 1;
        await tx.insert(schema.documentPropertyDefinitions).values({
          id: propertyId,
          ownerEmail: database.ownerEmail,
          orgId: database.orgId ?? null,
          databaseId: database.id,
          name: field.sourceFieldLabel,
          type,
          visibility: normalizePropertyVisibility(undefined),
          optionsJson: serializePropertyOptions(options),
          position,
          createdAt: now,
          updatedAt: now,
        });
        const [mapped] = await tx
          .update(schema.contentDatabaseSourceFields)
          .set({
            propertyId,
            localFieldKey: propertyId,
            mappingType: "property",
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.contentDatabaseSourceFields.id, field.id),
              isNull(schema.contentDatabaseSourceFields.propertyId),
            ),
          )
          .returning({ id: schema.contentDatabaseSourceFields.id });
        if (!mapped) {
          throw new Error(
            `Required Builder field ${field.sourceFieldLabel} changed while setup was running. No fields were added.`,
          );
        }
        const itemValues = reference
          ? referenceItemValues({
              rows: currentSourceRows,
              snapshot: reference,
            })
          : sourceFieldPropertyValuesFromRows(
              currentSourceRows,
              field.sourceFieldKey,
              type,
              options,
            );
        for (const batch of chunks(itemValues, 200)) {
          await tx.insert(schema.documentPropertyValues).values(
            batch.map((item) => ({
              id: nanoid(),
              ownerEmail: database.ownerEmail,
              documentId: item.documentId,
              propertyId,
              valueJson: serializePropertyValue(item.value),
              createdAt: now,
              updatedAt: now,
            })),
          );
        }
      }
      await tx
        .update(schema.contentDatabaseSources)
        .set({ metadataJson: enrichedMetadataJson, updatedAt: now })
        .where(eq(schema.contentDatabaseSources.id, source.id));
    });

    return getContentDatabaseResponse(database.id, { limit: 100, offset: 0 });
  },
});
