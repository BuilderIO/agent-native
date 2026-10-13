import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  createCustomField,
  getCustomField,
  listCustomFields,
  type FieldDefinition,
} from "./custom-fields/store.js";
import { UserInputError } from "./errors.js";

export const DEFAULT_QUEUES = ["Work", "Personal", "Other"];
const SETTING_KEY = "task-triage";

type QueueField = Extract<FieldDefinition, { type: "single_select" }>;

function usableQueueField(field: FieldDefinition | null): field is QueueField {
  return (
    field?.type === "single_select" &&
    field.config.options.length > 0 &&
    field.config.options.length <= 254
  );
}

export async function findQueueField(
  ownerEmail: string,
): Promise<QueueField | null> {
  const stored = await getUserSetting(ownerEmail, SETTING_KEY);
  const queueFieldId =
    stored == null
      ? null
      : z.object({ queueFieldId: z.string().nullable() }).parse(stored)
          .queueFieldId;
  if (queueFieldId) {
    const field = await getCustomField({ ownerEmail, fieldId: queueFieldId });
    if (field && !usableQueueField(field)) {
      throw new UserInputError(
        "Queue field needs 1 to 254 single-select options.",
      );
    }
    if (usableQueueField(field)) return field;
  }

  const { fields } = await listCustomFields({ ownerEmail });
  return (
    fields.find(
      (field): field is QueueField =>
        field.title.toLowerCase() === "queue" && usableQueueField(field),
    ) ?? null
  );
}

export async function ensureQueueField(
  ownerEmail: string,
): Promise<QueueField> {
  const existing = await findQueueField(ownerEmail);
  if (existing) {
    await putUserSetting(ownerEmail, SETTING_KEY, {
      queueFieldId: existing.id,
    });
    return existing;
  }

  const field = await createCustomField({
    ownerEmail,
    title: "Queue",
    type: "single_select",
    config: { options: DEFAULT_QUEUES.map((name) => ({ name })) },
  });
  if (!usableQueueField(field)) {
    throw new Error("Failed to create the Queue field.");
  }
  await putUserSetting(ownerEmail, SETTING_KEY, { queueFieldId: field.id });
  return field;
}
