import { createHash } from "node:crypto";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { schema } from "../server/db/index.js";
import {
  DOCUMENT_PROPERTY_VISIBILITIES,
  normalizePropertyValue,
  serializePropertyOptions,
} from "../shared/properties.js";
import { chunks } from "./_batch-utils.js";

const propertyType = z.enum(["text", "url", "date", "multi_select"]);
const option = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color: z.enum([
    "gray",
    "brown",
    "orange",
    "yellow",
    "green",
    "blue",
    "purple",
    "pink",
    "red",
  ]),
});
export const migrationPlanSchema = z.object({
  databaseId: z.string().min(1),
  databaseDocumentId: z.string().min(1),
  idempotencyKey: z.string().min(1).max(200),
  expectedRowCount: z.number().int().min(1).max(100),
  propertyDefinitions: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        type: propertyType,
        visibility: z.enum(DOCUMENT_PROPERTY_VISIBILITIES),
        options: z.array(option).max(100).optional(),
      }),
    )
    .max(100),
  rows: z
    .array(
      z.object({
        itemId: z.string().min(1),
        documentId: z.string().min(1),
        expectedUpdatedAt: z.string().min(1),
        content: z.string(),
        propertyValues: z.array(
          z.object({ propertyId: z.string().min(1), value: z.unknown() }),
        ),
        protectedPropertyValues: z
          .array(
            z.object({ propertyId: z.string().min(1), valueJson: z.string() }),
          )
          .max(100),
      }),
    )
    .max(100),
  legacyPropertyIds: z.array(z.string().min(1)).max(100).default([]),
});
export type MigrationPlan = z.infer<typeof migrationPlanSchema>;

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export const deterministicId = (prefix: string, ...parts: string[]) =>
  `${prefix}_${digest(parts).slice(0, 28)}`;

function duplicate(values: string[]) {
  return values.length !== new Set(values).size;
}
function valueId(documentId: string, propertyId: string) {
  return deterministicId("migration_value", documentId, propertyId);
}

export async function snapshotMigration(tx: any, databaseId: string) {
  const [database] = await tx
    .select()
    .from(schema.contentDatabases)
    .where(
      and(
        eq(schema.contentDatabases.id, databaseId),
        isNull(schema.contentDatabases.deletedAt),
      ),
    );
  if (!database) throw new Error("Database not found.");
  const [databaseDocument] = await tx
    .select()
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, database.documentId),
        eq(schema.documents.ownerEmail, database.ownerEmail),
        database.orgId
          ? eq(schema.documents.orgId, database.orgId)
          : isNull(schema.documents.orgId),
      ),
    );
  if (!databaseDocument)
    throw new Error("Database backing document not found.");
  const rows = await tx
    .select({ item: schema.contentDatabaseItems, document: schema.documents })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabaseItems.documentId),
    )
    .where(
      and(
        eq(schema.contentDatabaseItems.databaseId, databaseId),
        isNull(schema.documents.trashedAt),
      ),
    )
    .orderBy(
      asc(schema.contentDatabaseItems.position),
      asc(schema.contentDatabaseItems.id),
    );
  const definitions = await tx
    .select()
    .from(schema.documentPropertyDefinitions)
    .where(eq(schema.documentPropertyDefinitions.databaseId, databaseId))
    .orderBy(
      asc(schema.documentPropertyDefinitions.position),
      asc(schema.documentPropertyDefinitions.id),
    );
  const values = rows.length
    ? await tx
        .select()
        .from(schema.documentPropertyValues)
        .where(
          inArray(
            schema.documentPropertyValues.documentId,
            rows.map((r: any) => r.document.id),
          ),
        )
        .orderBy(
          asc(schema.documentPropertyValues.documentId),
          asc(schema.documentPropertyValues.propertyId),
          asc(schema.documentPropertyValues.id),
        )
    : [];
  const documentIds = [
    database.documentId,
    ...rows.map((r: any) => r.document.id),
  ];
  const shares = await tx
    .select()
    .from(schema.documentShares)
    .where(inArray(schema.documentShares.resourceId, documentIds))
    .orderBy(
      asc(schema.documentShares.resourceId),
      asc(schema.documentShares.principalType),
      asc(schema.documentShares.principalId),
      asc(schema.documentShares.role),
      asc(schema.documentShares.id),
    );
  const sourceFields = await tx
    .select()
    .from(schema.contentDatabaseSourceFields)
    .where(
      inArray(
        schema.contentDatabaseSourceFields.propertyId,
        definitions.map((definition: any) => definition.id),
      ),
    )
    .orderBy(asc(schema.contentDatabaseSourceFields.id));
  const sources = await tx
    .select({ id: schema.contentDatabaseSources.id })
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.databaseId, databaseId))
    .orderBy(asc(schema.contentDatabaseSources.id));
  return {
    database,
    databaseDocument,
    rows,
    definitions,
    values,
    shares,
    sourceFields,
    sources,
  };
}

export function validatePlan(
  plan: MigrationPlan,
  snapshot: Awaited<ReturnType<typeof snapshotMigration>>,
  options: { checkTimestamps?: boolean } = {},
) {
  if (
    plan.databaseId !== snapshot.database.id ||
    plan.databaseDocumentId !== snapshot.database.documentId
  )
    throw new Error(
      "Plan database identity does not match the active database.",
    );
  if (snapshot.database.systemRole || snapshot.sources.length > 0)
    throw new Error(
      "Migration requires an ordinary database that is not mapped to a source.",
    );
  if (
    plan.rows.length !== plan.expectedRowCount ||
    snapshot.rows.length !== plan.expectedRowCount
  )
    throw new Error(
      "Migration must include the exact full set of active database rows.",
    );
  if (
    duplicate(plan.rows.map((r) => r.itemId)) ||
    duplicate(plan.rows.map((r) => r.documentId))
  )
    throw new Error("Migration rows must be unique.");
  const actual = new Set(
    snapshot.rows.map((r: any) => `${r.item.id}:${r.document.id}`),
  );
  if (plan.rows.some((r) => !actual.has(`${r.itemId}:${r.documentId}`)))
    throw new Error("Migration contains a missing or foreign database row.");
  if (duplicate(plan.propertyDefinitions.map((p) => p.id)))
    throw new Error("New property definition IDs must be unique.");
  const names = plan.propertyDefinitions.map((p) =>
    p.name.trim().toLocaleLowerCase(),
  );
  if (duplicate(names))
    throw new Error("New property definition names must be unique.");
  const existingIds = new Set(snapshot.definitions.map((p: any) => p.id));
  const existingNames = new Set(
    snapshot.definitions.map((p: any) => p.name.trim().toLocaleLowerCase()),
  );
  for (const definition of plan.propertyDefinitions) {
    if (
      existingIds.has(definition.id) ||
      existingNames.has(definition.name.trim().toLocaleLowerCase())
    )
      throw new Error(
        "New property definition collides with an existing definition.",
      );
    if (definition.type === "multi_select") {
      if (
        !definition.options ||
        duplicate(definition.options.map((o) => o.id)) ||
        duplicate(
          definition.options.map((o) => o.name.trim().toLocaleLowerCase()),
        )
      )
        throw new Error(
          "Multi-select properties require unique stable option IDs and labels.",
        );
    } else if (definition.options?.length)
      throw new Error("Only multi-select properties may declare options.");
  }
  const newDefs = new Map(plan.propertyDefinitions.map((p) => [p.id, p]));
  const oldDefs = new Map<string, any>(
    snapshot.definitions.map((p: any) => [p.id, p]),
  );
  if (duplicate(plan.legacyPropertyIds))
    throw new Error("Legacy property IDs must be unique.");
  for (const propertyId of plan.legacyPropertyIds) {
    const definition = oldDefs.get(propertyId);
    if (!definition || definition.systemRole || definition.type === "blocks")
      throw new Error("Legacy property is missing or unsafe to finalize.");
    if (
      snapshot.sourceFields.some(
        (field: any) => field.propertyId === propertyId,
      )
    )
      throw new Error(
        "Legacy properties mapped to a source cannot be migrated.",
      );
    if (newDefs.has(propertyId))
      throw new Error("Legacy properties cannot be newly created properties.");
  }
  for (const row of plan.rows) {
    const persisted = snapshot.rows.find(
      (candidate: any) => candidate.item.id === row.itemId,
    )!;
    if (
      options.checkTimestamps !== false &&
      persisted.document.updatedAt !== row.expectedUpdatedAt
    )
      throw new Error(`Stale row ${row.documentId}.`);
    if (
      duplicate(row.propertyValues.map((v) => v.propertyId)) ||
      duplicate(row.protectedPropertyValues.map((v) => v.propertyId))
    )
      throw new Error("Row property values must be unique.");
    if (row.propertyValues.length !== newDefs.size)
      throw new Error(
        "Every row must contain every new property exactly once.",
      );
    for (const v of row.propertyValues) {
      const definition = newDefs.get(v.propertyId);
      if (!definition)
        throw new Error("Only newly declared properties may be written.");
      normalizeMigrationValue(definition, v.value);
    }
    for (const protectedValue of row.protectedPropertyValues) {
      const definition = oldDefs.get(protectedValue.propertyId);
      if (
        !definition ||
        definition.systemRole ||
        definition.type === "blocks" ||
        [
          "formula",
          "rollup",
          "id",
          "created_time",
          "created_by",
          "last_edited_time",
          "last_edited_by",
        ].includes(definition.type)
      )
        throw new Error("Unsafe protected property target.");
      const persistedValue =
        snapshot.values.find(
          (v: any) =>
            v.documentId === row.documentId &&
            v.propertyId === protectedValue.propertyId,
        )?.valueJson ?? "null";
      if (persistedValue !== protectedValue.valueJson)
        throw new Error(
          "Protected property values no longer match persisted values.",
        );
    }
  }
}

export function normalizeMigrationValue(
  definition: MigrationPlan["propertyDefinitions"][number],
  value: unknown,
) {
  if (definition.type === "multi_select") {
    if (!Array.isArray(value) || value.some((id) => typeof id !== "string"))
      throw new Error(`Unknown multi-select option for ${definition.name}.`);
    if (
      duplicate(value) ||
      value.some((id) => !definition.options!.some((o) => o.id === id))
    )
      throw new Error(`Unknown multi-select option for ${definition.name}.`);
    return value;
  }
  const normalized = normalizePropertyValue(definition.type, value);
  if (definition.type === "text" && typeof normalized !== "string")
    throw new Error(`Text property ${definition.name} must be a string.`);
  if (definition.type === "url") {
    if (typeof normalized !== "string")
      throw new Error(`URL property ${definition.name} must be a string.`);
    try {
      const url = new URL(normalized);
      if (url.protocol !== "http:" && url.protocol !== "https:")
        throw new Error();
    } catch {
      throw new Error(
        `URL property ${definition.name} must be an http/https URL.`,
      );
    }
  }
  if (definition.type === "date" && normalized === null)
    throw new Error(`Date property ${definition.name} cannot be null.`);
  return normalized;
}

export function serializeMigrationValue(
  definition: MigrationPlan["propertyDefinitions"][number],
  value: unknown,
) {
  return JSON.stringify(normalizeMigrationValue(definition, value));
}

export function snapshotDigest(
  snapshot: Awaited<ReturnType<typeof snapshotMigration>>,
) {
  const document = (value: any) => ({
    id: value.id,
    title: value.title,
    content: value.content,
    parentId: value.parentId,
    ownerEmail: value.ownerEmail,
    orgId: value.orgId,
    spaceId: value.spaceId,
    visibility: value.visibility,
    hideFromSearch: value.hideFromSearch,
    trashedAt: value.trashedAt,
    position: value.position,
  });
  return digest({
    database: {
      id: snapshot.database.id,
      documentId: snapshot.database.documentId,
      ownerEmail: snapshot.database.ownerEmail,
      orgId: snapshot.database.orgId,
      spaceId: snapshot.database.spaceId,
      deletedAt: snapshot.database.deletedAt,
    },
    databaseDocument: document(snapshot.databaseDocument),
    rows: snapshot.rows.map((row: any) => ({
      item: {
        id: row.item.id,
        databaseId: row.item.databaseId,
        documentId: row.item.documentId,
        ownerEmail: row.item.ownerEmail,
        orgId: row.item.orgId,
        position: row.item.position,
      },
      document: document(row.document),
    })),
    definitions: snapshot.definitions.map((definition: any) => ({
      id: definition.id,
      databaseId: definition.databaseId,
      ownerEmail: definition.ownerEmail,
      orgId: definition.orgId,
      systemRole: definition.systemRole,
      name: definition.name,
      type: definition.type,
      description: definition.description,
      visibility: definition.visibility,
      optionsJson: definition.optionsJson,
      position: definition.position,
    })),
    values: snapshot.values.map((value: any) => ({
      id: value.id,
      ownerEmail: value.ownerEmail,
      documentId: value.documentId,
      propertyId: value.propertyId,
      valueJson: value.valueJson,
    })),
    shares: snapshot.shares.map((share: any) => ({
      id: share.id,
      resourceId: share.resourceId,
      principalType: share.principalType,
      principalId: share.principalId,
      role: share.role,
    })),
    sourceFields: snapshot.sourceFields.map((field: any) => ({
      id: field.id,
      ownerEmail: field.ownerEmail,
      sourceId: field.sourceId,
      propertyId: field.propertyId,
      localFieldKey: field.localFieldKey,
      sourceFieldKey: field.sourceFieldKey,
      sourceFieldLabel: field.sourceFieldLabel,
      sourceFieldType: field.sourceFieldType,
      mappingType: field.mappingType,
      writeOwner: field.writeOwner,
      readOnly: field.readOnly,
      provenance: field.provenance,
      freshness: field.freshness,
    })),
    sources: snapshot.sources,
  });
}

export async function applyMigration(
  tx: any,
  plan: MigrationPlan,
  snapshot: Awaited<ReturnType<typeof snapshotMigration>>,
  receiptId: string,
  now: string,
) {
  const versions: Array<{
    documentId: string;
    versionId: string;
    appliedUpdatedAt: string;
  }> = [];
  const versionRows: Array<typeof schema.documentVersions.$inferInsert> = [];
  for (const row of plan.rows) {
    const persisted = snapshot.rows.find(
      (candidate: any) => candidate.item.id === row.itemId,
    )!;
    const versionId = deterministicId(
      "migration_version",
      receiptId,
      row.documentId,
    );
    versions.push({
      documentId: row.documentId,
      versionId,
      appliedUpdatedAt: now,
    });
    versionRows.push({
      id: versionId,
      ownerEmail: persisted.document.ownerEmail,
      documentId: row.documentId,
      title: persisted.document.title,
      content: persisted.document.content,
      createdAt: now,
    });
  }
  for (const batch of chunks(versionRows, 100))
    await tx.insert(schema.documentVersions).values(batch);
  for (const row of plan.rows) {
    const updated = await tx
      .update(schema.documents)
      .set({ content: row.content, updatedAt: now })
      .where(
        and(
          eq(schema.documents.id, row.documentId),
          eq(schema.documents.updatedAt, row.expectedUpdatedAt),
        ),
      )
      .returning({ id: schema.documents.id });
    if (updated.length !== 1) throw new Error(`Stale row ${row.documentId}.`);
  }
  const definitionRows = plan.propertyDefinitions.map((definition, index) => ({
    id: definition.id,
    ownerEmail: snapshot.database.ownerEmail,
    orgId: snapshot.database.orgId,
    databaseId: plan.databaseId,
    name: definition.name.trim(),
    type: definition.type,
    visibility: definition.visibility,
    optionsJson: serializePropertyOptions(
      definition.type === "multi_select" ? { options: definition.options } : {},
    ),
    position:
      Math.max(-1, ...snapshot.definitions.map((item: any) => item.position)) +
      1 +
      index,
    createdAt: now,
    updatedAt: now,
  }));
  for (const batch of chunks(definitionRows, 100))
    await tx.insert(schema.documentPropertyDefinitions).values(batch);
  const definitionById = new Map(
    plan.propertyDefinitions.map((definition) => [definition.id, definition]),
  );
  const valueRows: Array<typeof schema.documentPropertyValues.$inferInsert> =
    [];
  for (const row of plan.rows) {
    const persisted = snapshot.rows.find(
      (candidate: any) => candidate.item.id === row.itemId,
    )!;
    for (const entry of row.propertyValues)
      valueRows.push({
        id: valueId(row.documentId, entry.propertyId),
        ownerEmail: persisted.document.ownerEmail,
        documentId: row.documentId,
        propertyId: entry.propertyId,
        valueJson: serializeMigrationValue(
          definitionById.get(entry.propertyId)!,
          entry.value,
        ),
        createdAt: now,
        updatedAt: now,
      });
  }
  for (const batch of chunks(valueRows, 100))
    await tx.insert(schema.documentPropertyValues).values(batch);
  if (plan.rows.length || plan.propertyDefinitions.length)
    await tx
      .update(schema.contentDatabases)
      .set({ updatedAt: now })
      .where(eq(schema.contentDatabases.id, plan.databaseId));
  return {
    versions,
    createdPropertyIds: plan.propertyDefinitions.map((p) => p.id),
  };
}
