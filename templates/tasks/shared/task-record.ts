import { saveRevisionOf } from "@agent-native/core/save-conflict";

import type { FieldValue } from "../server/custom-fields/types.js";

export const TASK_RECORD = "task";

export type TaskRecord = {
  title: string;
  done: boolean;
  fields: Record<string, FieldValue>;
};

export function taskRecordOf(
  task: { title: string; done: boolean },
  fields: Iterable<{ id: string; value: FieldValue | null }>,
): TaskRecord {
  const values: Record<string, FieldValue> = {};
  for (const field of fields) {
    if (field.value !== null) values[field.id] = field.value;
  }
  return { title: task.title, done: task.done, fields: values };
}

export function taskRevisionOf(record: TaskRecord): string {
  return saveRevisionOf(record);
}
