import { and, eq, inArray } from "drizzle-orm";

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

export async function applyCustomFieldValuePatchesInTx(
  tx: DbHandle,
  input: {
    ownerEmail: string;
    taskId: string;
    patches: Map<string, PreparedFieldValuePatch>;
    updatedAt: string;
  },
): Promise<void> {
  for (const normalized of input.patches.values()) {
    if (normalized.value === null) {
      await deleteCustomFieldValues(
        {
          ownerEmail: input.ownerEmail,
          taskId: input.taskId,
          fieldId: normalized.field.id,
        },
        tx,
      );
      continue;
    }

    const valueJson = JSON.stringify(normalized.value);
    await tx
      .insert(customFieldValues)
      .values({
        id: createRecordId("cfv"),
        fieldId: normalized.field.id,
        taskId: input.taskId,
        valueJson,
        ownerEmail: input.ownerEmail,
        createdAt: input.updatedAt,
        updatedAt: input.updatedAt,
      })
      .onConflictDoUpdate({
        target: [
          customFieldValues.ownerEmail,
          customFieldValues.taskId,
          customFieldValues.fieldId,
        ],
        set: { valueJson, updatedAt: input.updatedAt },
      });
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

export async function updateCustomFieldValues(input: {
  ownerEmail: string;
  taskId: string;
  values: Array<{ fieldId: string; value: FieldValueInput }>;
  now?: string;
}): Promise<void> {
  const patches = await prepareCustomFieldValuePatches(input);
  if (patches.size === 0) return;

  const updatedAt = timestamp(input.now);
  await getDb().transaction(async (tx) => {
    await applyCustomFieldValuePatchesInTx(tx, {
      ownerEmail: input.ownerEmail,
      taskId: input.taskId,
      patches,
      updatedAt,
    });
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
    fieldId?: string;
  },
  db: DbHandle = getDb(),
): Promise<{ deletedValues: number }> {
  if (!input.id && !input.taskId && !input.fieldId) {
    throw new Error(
      "Provide id, taskId, or fieldId to delete custom field values.",
    );
  }

  const conditions = [eq(customFieldValues.ownerEmail, input.ownerEmail)];
  if (input.id) conditions.push(eq(customFieldValues.id, input.id));
  if (input.taskId) conditions.push(eq(customFieldValues.taskId, input.taskId));
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
