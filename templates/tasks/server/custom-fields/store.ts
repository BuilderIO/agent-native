import { and, asc, eq, inArray, max } from "drizzle-orm";

import { caseById, chunk } from "../db/bulk-write.js";
import { getDb } from "../db/index.js";
import { createRecordId, timestamp } from "../db/record-utils.js";
import { customFields } from "../db/schema.js";
import type { DbHandle } from "../db/transaction.js";
import { requireUserEmail } from "../stored-items/store.js";
import { removeTaskCardFieldId } from "../user-config/store.js";
import {
  canonicalizeFieldConfig,
  isEmptyFieldValue,
  normalizeFieldConfigInput,
  normalizeFieldTitle,
} from "./normalize.js";
import {
  parseFieldType,
  parseFieldConfigShape,
  parseField,
  parseFieldValueShape,
} from "./parse.js";
import type {
  FieldConfigInput,
  FieldDefinition,
  FieldType,
  FieldValue,
} from "./types.js";
import { validateFieldConfig, validateFieldTitle } from "./validate.js";
import {
  deleteCustomFieldValues,
  deleteCustomFieldValuesByIds,
  listCustomFieldValues,
  setCustomFieldValueJsonByIds,
} from "./values/store.js";

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

export async function createCustomField(
  input: {
    ownerEmail: string;
    title: string;
    type: FieldType;
    config?: unknown;
    now?: string;
  },
  db: DbHandle = getDb(),
): Promise<FieldDefinition> {
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

  await db.insert(customFields).values(field);
  const created = await getCustomField({
    ownerEmail: input.ownerEmail,
    fieldId: field.id,
  });
  if (!created) throw new Error("Failed to create custom field.");
  return created;
}

export async function getCustomField(
  input: {
    ownerEmail: string;
    fieldId: string;
  },
  db: DbHandle = getDb(),
): Promise<FieldDefinition | null> {
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

export async function listCustomFields(
  input: {
    ownerEmail: string;
    fieldIds?: string[];
  },
  db: DbHandle = getDb(),
): Promise<{ fields: FieldDefinition[] }> {
  const fieldIds = input.fieldIds ? [...new Set(input.fieldIds)] : undefined;
  if (fieldIds?.length === 0) return { fields: [] };

  const conditions = [eq(customFields.ownerEmail, input.ownerEmail)];
  if (fieldIds) conditions.push(inArray(customFields.id, fieldIds));

  const rows = await db
    .select()
    .from(customFields)
    .where(and(...conditions))
    .orderBy(asc(customFields.sortOrder), asc(customFields.createdAt));
  return { fields: rows.map(parseField) };
}

export async function updateCustomField(
  input: {
    ownerEmail: string;
    fieldId: string;
    title?: string;
    config?: unknown;
    now?: string;
  },
  db: DbHandle = getDb(),
): Promise<FieldDefinition> {
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

  const updated = await db.transaction(async (tx) => {
    await tx
      .update(customFields)
      .set(patch)
      .where(
        and(
          eq(customFields.ownerEmail, input.ownerEmail),
          eq(customFields.id, input.fieldId),
        ),
      );

    const [updatedRow] = await tx
      .select()
      .from(customFields)
      .where(
        and(
          eq(customFields.ownerEmail, input.ownerEmail),
          eq(customFields.id, input.fieldId),
        ),
      )
      .limit(1);
    if (!updatedRow) return null;
    const parsed = parseField(updatedRow);
    if (input.config !== undefined) {
      await cleanupValuesAfterConfigChange(parsed, tx);
    }
    return parsed;
  });
  if (!updated) throw new Error("Custom field not found.");
  return updated;
}

async function cleanupValuesAfterConfigChange(
  field: FieldDefinition,
  db: DbHandle,
): Promise<void> {
  if (field.type !== "single_select" && field.type !== "multi_select") return;
  const allowed = new Set(selectOptionIds(field));
  const rows = await listCustomFieldValues(
    { ownerEmail: field.ownerEmail, fieldId: field.id },
    db,
  );

  const staleIds: string[] = [];
  const trimmed: Array<{ id: string; value: FieldValue }> = [];

  for (const row of rows) {
    // Read the raw shape rather than `parseStoredValue`: that validates against
    // the new config and throws on exactly the removed options this cleans up.
    const value = parseFieldValueShape(JSON.parse(row.valueJson));
    if (isEmptyFieldValue(value)) {
      staleIds.push(row.id);
      continue;
    }
    if (field.type === "single_select") {
      if (typeof value !== "string" || !allowed.has(value)) {
        staleIds.push(row.id);
      }
      continue;
    }

    const nextValue = Array.isArray(value)
      ? value.filter(
          (optionId): optionId is string =>
            typeof optionId === "string" && allowed.has(optionId),
        )
      : [];
    if (nextValue.length === 0) {
      staleIds.push(row.id);
    } else if (!Array.isArray(value) || nextValue.length !== value.length) {
      trimmed.push({ id: row.id, value: nextValue });
    }
  }

  await deleteCustomFieldValuesByIds(
    { ownerEmail: field.ownerEmail, ids: staleIds },
    db,
  );
  await setCustomFieldValueJsonByIds(
    { ownerEmail: field.ownerEmail, entries: trimmed },
    db,
  );
}

function selectOptionIds(field: FieldDefinition) {
  return field.type === "single_select" || field.type === "multi_select"
    ? field.config.options.map((option) => option.id)
    : [];
}

export async function deleteCustomField(
  input: {
    ownerEmail: string;
    fieldId: string;
  },
  db: DbHandle = getDb(),
): Promise<{ ok: true; deletedValues: number }> {
  const existing = await getCustomField({
    ownerEmail: input.ownerEmail,
    fieldId: input.fieldId,
  });
  if (!existing) throw new Error("Custom field not found.");

  const { deletedValues } = await db.transaction(async (tx) => {
    const result = await deleteCustomFieldValues(input, tx);
    await tx
      .delete(customFields)
      .where(
        and(
          eq(customFields.ownerEmail, input.ownerEmail),
          eq(customFields.id, input.fieldId),
        ),
      );
    return result;
  });

  await removeTaskCardFieldId({
    ownerEmail: input.ownerEmail,
    fieldId: input.fieldId,
  });

  return { ok: true, deletedValues };
}

export async function reorderCustomFields(
  input: {
    ownerEmail: string;
    fieldIds: string[];
  },
  db: DbHandle = getDb(),
): Promise<{ fields: FieldDefinition[] }> {
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
  const entries = input.fieldIds.map((fieldId, index) => ({
    id: fieldId,
    value: index * SORT_GAP,
  }));

  await db.transaction(async (tx) => {
    for (const group of chunk(entries)) {
      await tx
        .update(customFields)
        .set({ sortOrder: caseById(customFields.id, group), updatedAt })
        .where(
          and(
            eq(customFields.ownerEmail, input.ownerEmail),
            inArray(
              customFields.id,
              group.map((entry) => entry.id),
            ),
          ),
        );
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
