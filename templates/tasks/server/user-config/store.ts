import { getUserSetting, putUserSetting } from "@agent-native/core/settings";

import {
  DEFAULT_TASK_CARD_FIELD_NAMES,
  TASK_CARD_FIELD_LIMIT,
} from "../../shared/visible-task-fields.js";
import { listCustomFields } from "../custom-fields/store.js";
import { UserInputError } from "../errors.js";

export { DEFAULT_TASK_CARD_FIELD_NAMES, TASK_CARD_FIELD_LIMIT };

const VISIBLE_TASK_FIELDS_SETTING_KEY = "visible-task-fields";

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

function parseFieldIdsValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .slice(0, TASK_CARD_FIELD_LIMIT);
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

async function readStoredFieldIds(
  ownerEmail: string,
): Promise<string[] | null> {
  const setting = await getUserSetting(
    ownerEmail,
    VISIBLE_TASK_FIELDS_SETTING_KEY,
  );
  return setting ? parseFieldIdsValue(setting.fieldIds) : null;
}

export async function getTaskCardFieldIds(input: {
  ownerEmail: string;
}): Promise<string[]> {
  const { fields } = await listCustomFields({ ownerEmail: input.ownerEmail });
  const knownIds = new Set(fields.map((field) => field.id));

  const stored = await readStoredFieldIds(input.ownerEmail);
  if (stored === null) {
    return fieldIdsForNames(DEFAULT_TASK_CARD_FIELD_NAMES, fields);
  }

  return filterKnownFieldIds(stored, knownIds);
}

export async function setTaskCardFieldIds(input: {
  ownerEmail: string;
  fieldIds: readonly string[];
}): Promise<string[]> {
  const { fields } = await listCustomFields({ ownerEmail: input.ownerEmail });
  const knownIds = new Set(fields.map((field) => field.id));
  const next = dedupeFieldIds(input.fieldIds);

  if (!next.every((fieldId) => knownIds.has(fieldId))) {
    throw new UserInputError("fieldIds must reference existing custom fields.");
  }

  await putUserSetting(input.ownerEmail, VISIBLE_TASK_FIELDS_SETTING_KEY, {
    fieldIds: next,
  });

  return next;
}

export async function removeTaskCardFieldId(input: {
  ownerEmail: string;
  fieldId: string;
}): Promise<void> {
  const stored = await readStoredFieldIds(input.ownerEmail);
  if (stored === null) return;

  const next = stored.filter((fieldId) => fieldId !== input.fieldId);
  await putUserSetting(input.ownerEmail, VISIBLE_TASK_FIELDS_SETTING_KEY, {
    fieldIds: next,
  });
}
