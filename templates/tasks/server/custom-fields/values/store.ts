import { and, eq, inArray, sql, type SQL } from "drizzle-orm";

import { caseById, chunk } from "../../db/bulk-write.js";
import { getDb } from "../../db/index.js";
import { createRecordId, timestamp } from "../../db/record-utils.js";
import {
  customFields,
  customFieldValues,
  type StoredCustomFieldValue,
} from "../../db/schema.js";
import type { DbHandle } from "../../db/transaction.js";
import { NotFoundError, UserInputError } from "../../errors.js";
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
  if (!task) throw new NotFoundError("Task not found.");

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
    if (!field) throw new NotFoundError("Custom field not found.");
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
  if (!fieldRow) throw new NotFoundError("Custom field not found.");

  return parseStoredValue(parseField(fieldRow), row);
}

export async function listCustomFieldValues(
  input: {
    ownerEmail: string;
    ids?: string[];
    taskIds?: string[];
    fieldIds?: string[];
  },
  db: DbHandle = getDb(),
): Promise<StoredCustomFieldValue[]> {
  const selector = buildValueSelector(input);
  if (!selector) {
    throw new UserInputError(
      "Provide ids, taskIds, or fieldIds to list custom field values.",
    );
  }
  if (selector.selectsNothing) return [];

  return db
    .select()
    .from(customFieldValues)
    .where(and(...selector.conditions));
}

export async function updateCustomFieldValues(
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

export async function updateCustomFieldValue(
  input: {
    ownerEmail: string;
    id: string;
    value: FieldValue;
    now?: string;
  },
  db: DbHandle = getDb(),
): Promise<void> {
  await updateCustomFieldValues(
    {
      ownerEmail: input.ownerEmail,
      entries: [{ id: input.id, value: input.value }],
      now: input.now,
    },
    db,
  );
}

/** Upsert a task's values by field id; an empty value clears the stored row. */
export async function updateCustomFieldValuesByTaskId(
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

export async function deleteCustomFieldValues(
  input: { ownerEmail: string; ids: string[] },
  db: DbHandle = getDb(),
): Promise<{ deletedValues: number }> {
  const ids = [...new Set(input.ids)];
  if (ids.length === 0) return { deletedValues: 0 };

  let deletedValues = 0;
  for (const group of chunk(ids)) {
    const result = await deleteValuesWhere(
      input.ownerEmail,
      [inArray(customFieldValues.id, group)],
      db,
    );
    deletedValues += result.deletedValues;
  }
  return { deletedValues };
}

export async function deleteCustomFieldValue(
  input: { ownerEmail: string; id: string },
  db: DbHandle = getDb(),
): Promise<{ deletedValues: number }> {
  return deleteCustomFieldValues(
    { ownerEmail: input.ownerEmail, ids: [input.id] },
    db,
  );
}

export async function deleteCustomFieldValuesByTaskIds(
  input: { ownerEmail: string; taskIds: string[] },
  db: DbHandle = getDb(),
): Promise<{ deletedValues: number }> {
  const taskIds = [...new Set(input.taskIds)];
  if (taskIds.length === 0) return { deletedValues: 0 };

  return deleteValuesWhere(
    input.ownerEmail,
    [inArray(customFieldValues.taskId, taskIds)],
    db,
  );
}

export async function deleteCustomFieldValuesByFieldIds(
  input: { ownerEmail: string; fieldIds: string[] },
  db: DbHandle = getDb(),
): Promise<{ deletedValues: number }> {
  const fieldIds = [...new Set(input.fieldIds)];
  if (fieldIds.length === 0) return { deletedValues: 0 };

  return deleteValuesWhere(
    input.ownerEmail,
    [inArray(customFieldValues.fieldId, fieldIds)],
    db,
  );
}

function buildValueSelector(input: {
  ownerEmail: string;
  ids?: string[];
  taskIds?: string[];
  fieldIds?: string[];
}): { conditions: SQL[]; selectsNothing: boolean } | null {
  const ids = input.ids ? [...new Set(input.ids)] : undefined;
  const taskIds = input.taskIds ? [...new Set(input.taskIds)] : undefined;
  const fieldIds = input.fieldIds ? [...new Set(input.fieldIds)] : undefined;
  if (!ids && !taskIds && !fieldIds) return null;

  // An explicit empty id list selects nothing; without this it would fall
  // through to matching every value the owner has.
  const selectsNothing =
    ids?.length === 0 || taskIds?.length === 0 || fieldIds?.length === 0;

  const conditions: SQL[] = [
    eq(customFieldValues.ownerEmail, input.ownerEmail),
  ];
  if (ids?.length) conditions.push(inArray(customFieldValues.id, ids));
  if (taskIds?.length)
    conditions.push(inArray(customFieldValues.taskId, taskIds));
  if (fieldIds?.length)
    conditions.push(inArray(customFieldValues.fieldId, fieldIds));

  return { conditions, selectsNothing };
}

async function deleteValuesWhere(
  ownerEmail: string,
  selectors: SQL[],
  db: DbHandle,
): Promise<{ deletedValues: number }> {
  const conditions = [
    eq(customFieldValues.ownerEmail, ownerEmail),
    ...selectors,
  ];

  const values = await db
    .select({ id: customFieldValues.id })
    .from(customFieldValues)
    .where(and(...conditions));

  if (values.length > 0) {
    await db.delete(customFieldValues).where(and(...conditions));
  }

  return { deletedValues: values.length };
}
