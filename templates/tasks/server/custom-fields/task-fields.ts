import { taskRecordOf, taskRevisionOf } from "../../shared/task-record.js";
import { getDb } from "../db/index.js";
import type { StoredCustomFieldValue } from "../db/schema.js";
import type { DbHandle } from "../db/transaction.js";
import { NotFoundError } from "../errors.js";
import { getStoredItem } from "../stored-items/store.js";
import type { Task } from "../tasks/store.js";
import { parseStoredValue } from "./parse.js";
import { listCustomFields } from "./store.js";
import type { FieldDefinition, FieldValue } from "./types.js";
import { listCustomFieldValues } from "./values/store.js";

export type TaskFieldValue = FieldDefinition & {
  value: FieldValue | null;
};

export type TaskWithRevision = Task & {
  revision: string;
};

export type TaskWithFields = TaskWithRevision & { fields: TaskFieldValue[] };

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
  const task = await getStoredItem({
    ownerEmail: input.ownerEmail,
    id: input.taskId,
    promotedToTask: true,
  });
  if (!task) throw new NotFoundError("Task not found.");

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

export async function getTaskWithFields(
  input: { ownerEmail: string; taskId: string },
  db: DbHandle = getDb(),
): Promise<TaskWithFields> {
  const item = await getStoredItem(
    { ownerEmail: input.ownerEmail, id: input.taskId, promotedToTask: true },
    db,
  );
  if (!item) throw new NotFoundError("Task not found.");
  const { promotedToTask: _, ...task } = item;

  const { fields } = await listCustomFields(
    { ownerEmail: input.ownerEmail },
    db,
  );
  const rows = await listCustomFieldValues(
    { ownerEmail: input.ownerEmail, taskIds: [task.id] },
    db,
  );
  return withTaskFields(
    task,
    fields,
    valuesByFieldId(rows, fieldsById(fields)),
  );
}

export async function attachFieldsToTasks(
  ownerEmail: string,
  tasks: Task[],
  db: DbHandle = getDb(),
): Promise<TaskWithFields[]> {
  if (tasks.length === 0) return [];

  const { fields } = await listCustomFields({ ownerEmail }, db);
  const rows = await listCustomFieldValues(
    { ownerEmail, taskIds: tasks.map((task) => task.id) },
    db,
  );
  const fieldsByIdMap = fieldsById(fields);
  const valuesByTaskIdMap = valuesByTaskId(rows, fieldsByIdMap);

  return tasks.map((task) =>
    withTaskFields(task, fields, valuesByTaskIdMap.get(task.id) ?? new Map()),
  );
}

function withTaskFields(
  task: Task,
  fields: FieldDefinition[],
  values: Map<string, FieldValue | null>,
): TaskWithFields {
  const taskFields = buildTaskFieldValues(fields, values);
  return {
    ...task,
    fields: taskFields,
    revision: taskRevisionOf(taskRecordOf(task, taskFields)),
  };
}

export async function attachRevisionsToTasks(
  ownerEmail: string,
  tasks: Task[],
): Promise<TaskWithRevision[]> {
  const withFields = await attachFieldsToTasks(ownerEmail, tasks);
  return withFields.map(({ fields: _fields, ...task }) => task);
}
