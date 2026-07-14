import type { StoredCustomFieldValue } from "../db/schema.js";
import { getTask, type Task } from "../tasks/store.js";
import { parseStoredValue } from "./parse.js";
import { listCustomFields } from "./store.js";
import type { FieldDefinition, FieldValue } from "./types.js";
import { listCustomFieldValues } from "./values/store.js";

export type TaskFieldValue = FieldDefinition & {
  value: FieldValue | null;
};

export type TaskWithFields = Task & { fields: TaskFieldValue[] };

function fieldsById(fields: FieldDefinition[]) {
  return new Map(fields.map((field) => [field.id, field]));
}

function valuesByFieldId(
  rows: StoredCustomFieldValue[],
  fieldsByIdMap: Map<string, FieldDefinition>,
): Map<string, FieldValue | null> {
  return new Map(
    rows.map((row) => {
      const field = fieldsByIdMap.get(row.fieldId);
      if (!field) throw new Error("Custom field not found.");
      return [row.fieldId, parseStoredValue(field, row)] as const;
    }),
  );
}

function valuesByTaskId(
  rows: StoredCustomFieldValue[],
  fieldsByIdMap: Map<string, FieldDefinition>,
): Map<string, Map<string, FieldValue | null>> {
  const result = new Map<string, Map<string, FieldValue | null>>();
  for (const row of rows) {
    let values = result.get(row.taskId);
    if (!values) {
      values = new Map();
      result.set(row.taskId, values);
    }
    const field = fieldsByIdMap.get(row.fieldId);
    if (!field) throw new Error("Custom field not found.");
    values.set(row.fieldId, parseStoredValue(field, row));
  }
  return result;
}

function buildTaskFieldValues(
  fields: FieldDefinition[],
  valuesByFieldIdMap: Map<string, FieldValue | null>,
): TaskFieldValue[] {
  return fields.map((field) => ({
    ...field,
    value: valuesByFieldIdMap.get(field.id) ?? null,
  }));
}

export async function listTaskFieldValues(input: {
  ownerEmail: string;
  taskId: string;
}): Promise<TaskFieldValue[]> {
  const task = await getTask({
    ownerEmail: input.ownerEmail,
    id: input.taskId,
  });
  if (!task) throw new Error("Task not found.");

  const [{ fields }, rows] = await Promise.all([
    listCustomFields({ ownerEmail: input.ownerEmail }),
    listCustomFieldValues({
      ownerEmail: input.ownerEmail,
      taskIds: [input.taskId],
    }),
  ]);
  const fieldsByIdMap = fieldsById(fields);
  return buildTaskFieldValues(fields, valuesByFieldId(rows, fieldsByIdMap));
}

export async function attachFieldsToTasks(
  ownerEmail: string,
  tasks: Task[],
): Promise<TaskWithFields[]> {
  if (tasks.length === 0) return [];

  const [{ fields }, rows] = await Promise.all([
    listCustomFields({ ownerEmail }),
    listCustomFieldValues({
      ownerEmail,
      taskIds: tasks.map((task) => task.id),
    }),
  ]);
  const fieldsByIdMap = fieldsById(fields);
  const valuesByTaskIdMap = valuesByTaskId(rows, fieldsByIdMap);

  return tasks.map((task) => ({
    ...task,
    fields: buildTaskFieldValues(
      fields,
      valuesByTaskIdMap.get(task.id) ?? new Map(),
    ),
  }));
}
