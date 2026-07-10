import { and, asc, eq, inArray, max } from "drizzle-orm";
import { createRecordId, timestamp } from "../db/record-utils.js";
import { getDb } from "../db/index.js";
import { runTransaction } from "../db/transaction.js";
import { customFields } from "../db/schema.js";
import { requireUserEmail } from "../stored-items/store.js";
import {
  parseFieldType,
  parseFieldConfigShape,
  parseField,
  parseStoredValue,
} from "./parse.js";
import { validateFieldConfig, validateFieldTitle } from "./validate.js";
import {
  canonicalizeFieldConfig,
  normalizeFieldConfigInput,
  normalizeFieldTitle,
} from "./normalize.js";
import type { FieldConfigInput, FieldDefinition, FieldType } from "./types.js";
import {
  deleteCustomFieldValues,
  listCustomFieldValues,
  updateCustomFieldValue,
} from "./values/store.js";
import type { TransactionDb } from "../db/transaction.js";
import { removeTaskCardFieldId } from "../user-config/store.js";

export { requireUserEmail };
export type {
  FieldConfig,
  FieldDefinition,
  FieldType,
  FieldValue,
  FieldValueInput,
  SelectColorToken,
  SelectOption,
} from "./types.js";
export type {
  CurrencyConfigInput,
  EmptyConfigInput,
  FieldConfigInput,
  NumericConfigInput,
  PercentConfigInput,
  SelectConfigInput,
  SelectOptionInput,
} from "./types.js";
export { FIELD_TYPES, SELECT_COLOR_TOKENS } from "./types.js";
export {
  createCustomFieldActionSchema,
  fieldConfigShapeSchema,
  fieldValueInputSchema,
  updateCustomFieldConfigActionSchema,
} from "./schema.js";

const SORT_GAP = 1000;

export async function createCustomField(input: {
  ownerEmail: string;
  title: string;
  type: FieldType;
  config?: unknown;
  now?: string;
}): Promise<FieldDefinition> {
  const createdAt = timestamp(input.now);
  const type = parseFieldType(input.type);
  validateFieldTitle(input.title);
  const field = {
    id: createRecordId("fld"),
    title: normalizeFieldTitle(input.title),
    type,
    configJson: serializeFieldConfig(type, input.config),
    sortOrder: await nextSortOrder(input.ownerEmail),
    ownerEmail: input.ownerEmail,
    createdAt,
    updatedAt: createdAt,
  };

  const db = getDb();
  await db.insert(customFields).values(field);
  const created = await getCustomField({
    ownerEmail: input.ownerEmail,
    fieldId: field.id,
  });
  if (!created) throw new Error("Failed to create custom field.");
  return created;
}

export async function getCustomField(input: {
  ownerEmail: string;
  fieldId: string;
}): Promise<FieldDefinition | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(customFields)
    .where(
      and(
        eq(customFields.ownerEmail, input.ownerEmail),
        eq(customFields.id, input.fieldId),
      ),
    )
    .limit(1);
  return row ? parseField(row) : null;
}

export async function listCustomFields(input: {
  ownerEmail: string;
  fieldIds?: string[];
}): Promise<{ fields: FieldDefinition[] }> {
  const fieldIds = input.fieldIds ? [...new Set(input.fieldIds)] : undefined;
  if (fieldIds?.length === 0) return { fields: [] };

  const conditions = [eq(customFields.ownerEmail, input.ownerEmail)];
  if (fieldIds) conditions.push(inArray(customFields.id, fieldIds));

  const db = getDb();
  const rows = await db
    .select()
    .from(customFields)
    .where(and(...conditions))
    .orderBy(asc(customFields.sortOrder), asc(customFields.createdAt));
  return { fields: rows.map(parseField) };
}

export async function updateCustomField(input: {
  ownerEmail: string;
  fieldId: string;
  title?: string;
  config?: unknown;
  now?: string;
}): Promise<FieldDefinition> {
  const existing = await getCustomField({
    ownerEmail: input.ownerEmail,
    fieldId: input.fieldId,
  });
  if (!existing) throw new Error("Custom field not found.");

  if (input.title === undefined && input.config === undefined) return existing;

  const patch: Partial<typeof customFields.$inferInsert> = {
    updatedAt: timestamp(input.now),
  };
  if (input.title !== undefined) {
    validateFieldTitle(input.title);
    patch.title = normalizeFieldTitle(input.title);
  }
  if (input.config !== undefined) {
    patch.configJson = serializeFieldConfig(existing.type, input.config);
  }

  const updated = runTransaction(getDb(), (tx) => {
    tx.update(customFields)
      .set(patch)
      .where(
        and(
          eq(customFields.ownerEmail, input.ownerEmail),
          eq(customFields.id, input.fieldId),
        ),
      )
      .run();

    const [updatedRow] = tx
      .select()
      .from(customFields)
      .where(
        and(
          eq(customFields.ownerEmail, input.ownerEmail),
          eq(customFields.id, input.fieldId),
        ),
      )
      .limit(1)
      .all();
    if (!updatedRow) return null;
    const parsed = parseField(updatedRow);
    if (input.config !== undefined) {
      cleanupValuesAfterConfigChange(parsed, tx);
    }
    return parsed;
  });
  if (!updated) throw new Error("Custom field not found.");
  return updated;
}

function cleanupValuesAfterConfigChange(
  field: FieldDefinition,
  db: TransactionDb,
) {
  if (field.type !== "single_select" && field.type !== "multi_select") return;
  const allowed = new Set(selectOptionIds(field));
  const rows = listCustomFieldValues(
    { ownerEmail: field.ownerEmail, fieldId: field.id },
    db,
  );

  for (const row of rows) {
    const value = parseStoredValue(field, row);
    if (value === null) {
      deleteCustomFieldValues({ ownerEmail: field.ownerEmail, id: row.id }, db);
      continue;
    }
    if (field.type === "single_select") {
      if (typeof value !== "string" || !allowed.has(value)) {
        deleteCustomFieldValues(
          { ownerEmail: field.ownerEmail, id: row.id },
          db,
        );
      }
      continue;
    }

    const nextValue = Array.isArray(value)
      ? value.filter((optionId) => allowed.has(optionId))
      : [];
    if (nextValue.length === 0) {
      deleteCustomFieldValues({ ownerEmail: field.ownerEmail, id: row.id }, db);
    } else if (nextValue.length !== (value as string[]).length) {
      updateCustomFieldValue(
        { ownerEmail: field.ownerEmail, id: row.id, value: nextValue },
        db,
      );
    }
  }
}

function selectOptionIds(field: FieldDefinition) {
  return field.type === "single_select" || field.type === "multi_select"
    ? field.config.options.map((option) => option.id)
    : [];
}

export async function deleteCustomField(input: {
  ownerEmail: string;
  fieldId: string;
}): Promise<{ ok: true; deletedValues: number }> {
  const existing = await getCustomField({
    ownerEmail: input.ownerEmail,
    fieldId: input.fieldId,
  });
  if (!existing) throw new Error("Custom field not found.");

  const { deletedValues } = runTransaction(getDb(), (tx) => {
    const result = deleteCustomFieldValues(input, tx);
    tx.delete(customFields)
      .where(
        and(
          eq(customFields.ownerEmail, input.ownerEmail),
          eq(customFields.id, input.fieldId),
        ),
      )
      .run();
    return result;
  });

  await removeTaskCardFieldId({
    ownerEmail: input.ownerEmail,
    fieldId: input.fieldId,
  });

  return { ok: true, deletedValues };
}

export async function reorderCustomFields(input: {
  ownerEmail: string;
  fieldIds: string[];
}): Promise<{ fields: FieldDefinition[] }> {
  const { fields: existing } = await listCustomFields({
    ownerEmail: input.ownerEmail,
  });
  const existingIds = new Set(existing.map((field) => field.id));

  if (new Set(input.fieldIds).size !== input.fieldIds.length) {
    throw new Error("fieldIds must not contain duplicates.");
  }
  if (input.fieldIds.length !== existingIds.size) {
    throw new Error("fieldIds must include every field exactly once.");
  }
  if (!input.fieldIds.every((fieldId) => existingIds.has(fieldId))) {
    throw new Error("fieldIds must match the current field list.");
  }

  const updatedAt = timestamp();
  runTransaction(getDb(), (tx) => {
    for (let index = 0; index < input.fieldIds.length; index += 1) {
      const fieldId = input.fieldIds[index];
      if (!fieldId) continue;
      tx.update(customFields)
        .set({ sortOrder: index * SORT_GAP, updatedAt })
        .where(
          and(
            eq(customFields.ownerEmail, input.ownerEmail),
            eq(customFields.id, fieldId),
          ),
        )
        .run();
    }
  });

  return listCustomFields({ ownerEmail: input.ownerEmail });
}

function serializeFieldConfig<T extends FieldType>(type: T, config?: unknown) {
  const shaped = parseFieldConfigShape(type, config ?? {});
  validateFieldConfig(type, shaped);
  return JSON.stringify(
    canonicalizeFieldConfig(type, normalizeFieldConfigInput(type, shaped)),
  );
}

async function nextSortOrder(ownerEmail: string) {
  const db = getDb();
  const [row] = await db
    .select({ maxSortOrder: max(customFields.sortOrder) })
    .from(customFields)
    .where(eq(customFields.ownerEmail, ownerEmail));
  return (row?.maxSortOrder ?? -SORT_GAP) + SORT_GAP;
}
