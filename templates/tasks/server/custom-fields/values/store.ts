import { and, eq, inArray, sql } from "drizzle-orm";

import { caseById, chunk } from "../../db/bulk-write.js";
import { getDb } from "../../db/index.js";
import { createRecordId, timestamp } from "../../db/record-utils.js";
import {
  customFields,
  customFieldValues,
  type StoredCustomFieldValue,
} from "../../db/schema.js";
import { runTransaction, type TransactionDb } from "../../db/transaction.js";
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

export async function prepareCustomFieldValuePatches(input: {
  ownerEmail: string;
  taskId: string;
  values: Array<{ fieldId: string; value: FieldValueInput }>;
}): Promise<Map<string, PreparedFieldValuePatch>> {
  if (input.values.length === 0) {
    return new Map();
  }

  const task = await getStoredItem({
    ownerEmail: input.ownerEmail,
    id: input.taskId,
    promotedToTask: true,
  });
  if (!task) throw new Error("Task not found.");

  const db = getDb();
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

export function applyCustomFieldValuePatchesInTx(
  tx: TransactionDb,
  input: {
    ownerEmail: string;
    taskId: string;
    patches: Map<string, PreparedFieldValuePatch>;
    updatedAt: string;
  },
): void {
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
    tx.delete(customFieldValues)
      .where(
        and(
          eq(customFieldValues.ownerEmail, input.ownerEmail),
          eq(customFieldValues.taskId, input.taskId),
          inArray(customFieldValues.fieldId, clearedFieldIds),
        ),
      )
      .run();
  }

  // One multi-row upsert: `excluded` refers to the row that would have been
  // inserted, so each conflicting row keeps its own value.
  for (const group of chunk(rows)) {
    tx.insert(customFieldValues)
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
      })
      .run();
  }
}

export async function getCustomFieldValue(input: {
  ownerEmail: string;
  taskId: string;
  fieldId: string;
}): Promise<FieldValue | null> {
  const db = getDb();
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

type FieldValueDb = ReturnType<typeof getDb> | TransactionDb;

export function listCustomFieldValues(
  input: {
    ownerEmail: string;
    taskIds?: string[];
    fieldId?: string;
  },
  db: FieldValueDb = getDb(),
): StoredCustomFieldValue[] {
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
    .where(and(...conditions))
    .all();
}

/** Delete value rows by id, without the existence read `deleteCustomFieldValues` does. */
export function deleteCustomFieldValuesByIds(
  input: { ownerEmail: string; ids: string[] },
  db: FieldValueDb = getDb(),
): void {
  const ids = [...new Set(input.ids)];
  if (ids.length === 0) return;

  for (const group of chunk(ids)) {
    db.delete(customFieldValues)
      .where(
        and(
          eq(customFieldValues.ownerEmail, input.ownerEmail),
          inArray(customFieldValues.id, group),
        ),
      )
      .run();
  }
}

/** Write a different stored value to each row in one statement per chunk. */
export function setCustomFieldValueJsonByIds(
  input: {
    ownerEmail: string;
    entries: Array<{ id: string; value: FieldValue }>;
    now?: string;
  },
  db: FieldValueDb = getDb(),
): void {
  if (input.entries.length === 0) return;

  const updatedAt = timestamp(input.now);
  const entries = input.entries.map((entry) => ({
    id: entry.id,
    value: JSON.stringify(entry.value),
  }));

  for (const group of chunk(entries)) {
    db.update(customFieldValues)
      .set({
        valueJson: caseById(customFieldValues.id, group),
        updatedAt,
      })
      .where(
        and(
          eq(customFieldValues.ownerEmail, input.ownerEmail),
          inArray(
            customFieldValues.id,
            group.map((entry) => entry.id),
          ),
        ),
      )
      .run();
  }
}

export async function updateCustomFieldValues(input: {
  ownerEmail: string;
  taskId: string;
  values: Array<{ fieldId: string; value: FieldValueInput }>;
  now?: string;
}): Promise<void> {
  const patches = await prepareCustomFieldValuePatches(input);
  if (patches.size === 0) return;

  const updatedAt = timestamp(input.now);
  runTransaction(getDb(), (tx) => {
    applyCustomFieldValuePatchesInTx(tx, {
      ownerEmail: input.ownerEmail,
      taskId: input.taskId,
      patches,
      updatedAt,
    });
  });
}

export function updateCustomFieldValue(
  input: {
    ownerEmail: string;
    id: string;
    value: FieldValue;
    now?: string;
  },
  db: FieldValueDb = getDb(),
): void {
  db.update(customFieldValues)
    .set({
      valueJson: JSON.stringify(input.value),
      updatedAt: timestamp(input.now),
    })
    .where(
      and(
        eq(customFieldValues.ownerEmail, input.ownerEmail),
        eq(customFieldValues.id, input.id),
      ),
    )
    .run();
}

export function deleteCustomFieldValues(
  input: {
    ownerEmail: string;
    id?: string;
    taskId?: string;
    taskIds?: string[];
    fieldId?: string;
  },
  db: FieldValueDb = getDb(),
): { deletedValues: number } {
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

  const values = db
    .select({ id: customFieldValues.id })
    .from(customFieldValues)
    .where(and(...conditions))
    .all();

  if (values.length > 0) {
    db.delete(customFieldValues)
      .where(and(...conditions))
      .run();
  }

  return { deletedValues: values.length };
}
