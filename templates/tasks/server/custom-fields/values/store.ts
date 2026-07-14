import { and, eq, inArray, sql } from "drizzle-orm";

import { caseById, chunk } from "../../db/bulk-write.js";
import { getDb } from "../../db/index.js";
import { createRecordId, timestamp } from "../../db/record-utils.js";
import {
  customFields,
  customFieldValues,
  type StoredCustomFieldValue,
} from "../../db/schema.js";
import type { DbHandle } from "../../db/transaction.js";
import { getStoredItem } from "../../stored-items/store.js";
import { isEmptyFieldValue, normalizeFieldValue } from "../normalize.js";
import {
  parseField,
  parseStoredValue,
  parseFieldValueShape,
} from "../parse.js";
import type { FieldDefinition, FieldValue, FieldValueInput } from "../types.js";
import { validateFieldValue } from "../validate.js";

export type { FieldValue, FieldValueInput } from "../types.js";

export type PreparedFieldValuePatch = {
  field: FieldDefinition;
  value: FieldValue | null;
};

export async function prepareCustomFieldValuePatches(
  input: {
    ownerEmail: string;
    taskId: string;
    values: Array<{ fieldId: string; value: FieldValueInput }>;
  },
  db: DbHandle = getDb(),
): Promise<Map<string, PreparedFieldValuePatch>> {
  if (input.values.length === 0) {
    return new Map();
  }

  const task = await getStoredItem(
    {
      ownerEmail: input.ownerEmail,
      id: input.taskId,
      promotedToTask: true,
    },
    db,
  );
  if (!task) throw new Error("Task not found.");

  const fields = await db
    .select()
    .from(customFields)
    .where(
      and(
        eq(customFields.ownerEmail, input.ownerEmail),
        inArray(
          customFields.id,
          input.values.map((value) => value.fieldId),
        ),
      ),
    );

  const fieldsById = new Map(
    fields.map((field) => [field.id, parseField(field)]),
  );
  const normalizedValues = new Map<string, PreparedFieldValuePatch>();
  for (const value of input.values) {
    const field = fieldsById.get(value.fieldId);
    if (!field) throw new Error("Custom field not found.");
    let normalizedValue: FieldValue | null;
    const shaped = parseFieldValueShape(value.value);
    if (isEmptyFieldValue(shaped)) {
      normalizedValue = null;
    } else {
      validateFieldValue(field, shaped);
      normalizedValue = normalizeFieldValue(field, shaped);
    }
    normalizedValues.set(value.fieldId, {
      field,
      value: normalizedValue,
    });
  }

  return normalizedValues;
}

export async function applyCustomFieldValuePatches(
  input: {
    ownerEmail: string;
    taskId: string;
    patches: Map<string, PreparedFieldValuePatch>;
    updatedAt: string;
  },
  db: DbHandle = getDb(),
): Promise<void> {
  const patches = [...input.patches.values()];
  const clearedFieldIds = patches
    .filter((patch) => patch.value === null)
    .map((patch) => patch.field.id);
  const rows = patches
    .filter((patch) => patch.value !== null)
    .map((patch) => ({
      id: createRecordId("cfv"),
      fieldId: patch.field.id,
      taskId: input.taskId,
      valueJson: JSON.stringify(patch.value),
      ownerEmail: input.ownerEmail,
      createdAt: input.updatedAt,
      updatedAt: input.updatedAt,
    }));

  if (clearedFieldIds.length > 0) {
    await db
      .delete(customFieldValues)
      .where(
        and(
          eq(customFieldValues.ownerEmail, input.ownerEmail),
          eq(customFieldValues.taskId, input.taskId),
          inArray(customFieldValues.fieldId, clearedFieldIds),
        ),
      );
  }

  for (const group of chunk(rows)) {
    await db
      .insert(customFieldValues)
      .values(group)
      .onConflictDoUpdate({
        target: [
          customFieldValues.ownerEmail,
          customFieldValues.taskId,
          customFieldValues.fieldId,
        ],
        set: {
          valueJson: sql`excluded.value_json`,
          updatedAt: input.updatedAt,
        },
      });
  }
}

export async function deleteCustomFieldValuesByIds(
  input: { ownerEmail: string; ids: string[] },
  db: DbHandle = getDb(),
): Promise<void> {
  const ids = [...new Set(input.ids)];
  if (ids.length === 0) return;

  for (const group of chunk(ids)) {
    await db
      .delete(customFieldValues)
      .where(
        and(
          eq(customFieldValues.ownerEmail, input.ownerEmail),
          inArray(customFieldValues.id, group),
        ),
      );
  }
}

export async function setCustomFieldValueJsonByIds(
  input: {
    ownerEmail: string;
    entries: Array<{ id: string; value: FieldValue }>;
    now?: string;
  },
  db: DbHandle = getDb(),
): Promise<void> {
  if (input.entries.length === 0) return;

  const updatedAt = timestamp(input.now);
  const entries = input.entries.map((entry) => ({
    id: entry.id,
    value: JSON.stringify(entry.value),
  }));

  for (const group of chunk(entries)) {
    await db
      .update(customFieldValues)
      .set({ valueJson: caseById(customFieldValues.id, group), updatedAt })
      .where(
        and(
          eq(customFieldValues.ownerEmail, input.ownerEmail),
          inArray(
            customFieldValues.id,
            group.map((entry) => entry.id),
          ),
        ),
      );
  }
}

export async function getCustomFieldValue(
  input: {
    ownerEmail: string;
    taskId: string;
    fieldId: string;
  },
  db: DbHandle = getDb(),
): Promise<FieldValue | null> {
  const [row] = await db
    .select()
    .from(customFieldValues)
    .where(
      and(
        eq(customFieldValues.ownerEmail, input.ownerEmail),
        eq(customFieldValues.taskId, input.taskId),
        eq(customFieldValues.fieldId, input.fieldId),
      ),
    )
    .limit(1);
  if (!row) return null;

  const [fieldRow] = await db
    .select()
    .from(customFields)
    .where(
      and(
        eq(customFields.ownerEmail, input.ownerEmail),
        eq(customFields.id, input.fieldId),
      ),
    )
    .limit(1);
  if (!fieldRow) throw new Error("Custom field not found.");

  return parseStoredValue(parseField(fieldRow), row);
}

export async function listCustomFieldValues(
  input: {
    ownerEmail: string;
    taskIds?: string[];
    fieldId?: string;
  },
  db: DbHandle = getDb(),
): Promise<StoredCustomFieldValue[]> {
  const taskIds = input.taskIds ? [...new Set(input.taskIds)] : undefined;
  if (!taskIds?.length && !input.fieldId) {
    throw new Error("Provide taskIds or fieldId to list custom field values.");
  }
  if (taskIds?.length === 0) return [];

  const conditions = [eq(customFieldValues.ownerEmail, input.ownerEmail)];
  if (taskIds?.length)
    conditions.push(inArray(customFieldValues.taskId, taskIds));
  if (input.fieldId)
    conditions.push(eq(customFieldValues.fieldId, input.fieldId));

  return db
    .select()
    .from(customFieldValues)
    .where(and(...conditions));
}

export async function updateCustomFieldValues(
  input: {
    ownerEmail: string;
    taskId: string;
    values: Array<{ fieldId: string; value: FieldValueInput }>;
    now?: string;
  },
  db: DbHandle = getDb(),
): Promise<void> {
  const patches = await prepareCustomFieldValuePatches(input, db);
  if (patches.size === 0) return;

  const updatedAt = timestamp(input.now);
  await db.transaction(async (tx) => {
    await applyCustomFieldValuePatches(
      {
        ownerEmail: input.ownerEmail,
        taskId: input.taskId,
        patches,
        updatedAt,
      },
      tx,
    );
  });
}

export async function updateCustomFieldValue(
  input: {
    ownerEmail: string;
    id: string;
    value: FieldValue;
    now?: string;
  },
  db: DbHandle = getDb(),
): Promise<void> {
  await db
    .update(customFieldValues)
    .set({
      valueJson: JSON.stringify(input.value),
      updatedAt: timestamp(input.now),
    })
    .where(
      and(
        eq(customFieldValues.ownerEmail, input.ownerEmail),
        eq(customFieldValues.id, input.id),
      ),
    );
}

export async function deleteCustomFieldValues(
  input: {
    ownerEmail: string;
    id?: string;
    taskId?: string;
    taskIds?: string[];
    fieldId?: string;
  },
  db: DbHandle = getDb(),
): Promise<{ deletedValues: number }> {
  if (!input.id && !input.taskId && !input.taskIds && !input.fieldId) {
    throw new Error(
      "Provide id, taskId, taskIds, or fieldId to delete custom field values.",
    );
  }

  // An explicit empty id list selects nothing; without this it would fall
  // through to deleting every value the owner has.
  if (input.taskIds && input.taskIds.length === 0) {
    return { deletedValues: 0 };
  }

  const conditions = [eq(customFieldValues.ownerEmail, input.ownerEmail)];
  if (input.id) conditions.push(eq(customFieldValues.id, input.id));
  if (input.taskId) conditions.push(eq(customFieldValues.taskId, input.taskId));
  if (input.taskIds)
    conditions.push(inArray(customFieldValues.taskId, input.taskIds));
  if (input.fieldId)
    conditions.push(eq(customFieldValues.fieldId, input.fieldId));

  const values = await db
    .select({ id: customFieldValues.id })
    .from(customFieldValues)
    .where(and(...conditions));

  if (values.length > 0) {
    await db.delete(customFieldValues).where(and(...conditions));
  }

  return { deletedValues: values.length };
}
