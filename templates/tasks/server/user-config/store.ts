import { eq } from "drizzle-orm";

import {
  DEFAULT_TASK_CARD_FIELD_NAMES,
  TASK_CARD_FIELD_LIMIT,
} from "../../shared/visible-task-fields.js";
import { listCustomFields } from "../custom-fields/store.js";
import { getDb } from "../db/index.js";
import { timestamp } from "../db/record-utils.js";
import { userConfig } from "../db/schema.js";
import type { DbHandle } from "../db/transaction.js";

export { DEFAULT_TASK_CARD_FIELD_NAMES, TASK_CARD_FIELD_LIMIT };

function fieldIdsForNames(
  fieldNames: readonly string[],
  fields: readonly { id: string; title: string }[],
) {
  const fieldsByName = new Map(
    fields.map((field) => [field.title.toLowerCase(), field.id]),
  );
  return fieldNames
    .map((name) => fieldsByName.get(name.toLowerCase()))
    .filter((id): id is string => Boolean(id))
    .slice(0, TASK_CARD_FIELD_LIMIT);
}

function parseStoredFieldIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is string => typeof value === "string")
      .slice(0, TASK_CARD_FIELD_LIMIT);
  } catch {
    return [];
  }
}

function dedupeFieldIds(fieldIds: readonly string[]) {
  return [...new Set(fieldIds)].slice(0, TASK_CARD_FIELD_LIMIT);
}

function filterKnownFieldIds(
  fieldIds: readonly string[],
  knownIds: ReadonlySet<string>,
) {
  return fieldIds.filter((fieldId) => knownIds.has(fieldId));
}

export async function getTaskCardFieldIds(
  input: {
    ownerEmail: string;
  },
  db: DbHandle = getDb(),
): Promise<string[]> {
  const { fields } = await listCustomFields({ ownerEmail: input.ownerEmail });
  const knownIds = new Set(fields.map((field) => field.id));

  const [row] = await db
    .select()
    .from(userConfig)
    .where(eq(userConfig.ownerEmail, input.ownerEmail))
    .limit(1);

  if (!row) {
    return fieldIdsForNames(DEFAULT_TASK_CARD_FIELD_NAMES, fields);
  }

  return filterKnownFieldIds(
    parseStoredFieldIds(row.taskCardFieldIdsJson),
    knownIds,
  );
}

export async function setTaskCardFieldIds(
  input: {
    ownerEmail: string;
    fieldIds: readonly string[];
    now?: string;
  },
  db: DbHandle = getDb(),
): Promise<string[]> {
  const { fields } = await listCustomFields({ ownerEmail: input.ownerEmail });
  const knownIds = new Set(fields.map((field) => field.id));
  const next = dedupeFieldIds(input.fieldIds);

  if (!next.every((fieldId) => knownIds.has(fieldId))) {
    throw new Error("fieldIds must reference existing custom fields.");
  }

  const updatedAt = timestamp(input.now);
  const taskCardFieldIdsJson = JSON.stringify(next);

  await db
    .insert(userConfig)
    .values({
      ownerEmail: input.ownerEmail,
      taskCardFieldIdsJson,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: userConfig.ownerEmail,
      set: { taskCardFieldIdsJson, updatedAt },
    });

  return next;
}

export async function removeTaskCardFieldId(
  input: {
    ownerEmail: string;
    fieldId: string;
    now?: string;
  },
  db: DbHandle = getDb(),
): Promise<void> {
  const [row] = await db
    .select()
    .from(userConfig)
    .where(eq(userConfig.ownerEmail, input.ownerEmail))
    .limit(1);

  if (!row) return;

  const next = parseStoredFieldIds(row.taskCardFieldIdsJson).filter(
    (fieldId) => fieldId !== input.fieldId,
  );

  await db
    .update(userConfig)
    .set({
      taskCardFieldIdsJson: JSON.stringify(next),
      updatedAt: timestamp(input.now),
    })
    .where(eq(userConfig.ownerEmail, input.ownerEmail));
}
