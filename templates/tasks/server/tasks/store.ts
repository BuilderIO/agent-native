import type { FieldValueInput } from "../custom-fields/types.js";
import {
  applyCustomFieldValuePatchesInTx,
  deleteCustomFieldValues,
  prepareCustomFieldValuePatches,
  updateCustomFieldValues,
} from "../custom-fields/values/store.js";
import { getDb } from "../db/index.js";
import type { StoredItem } from "../db/schema.js";
import {
  assertStoredItemsExist,
  createStoredItem,
  deleteStoredItem,
  deleteStoredItemInTx,
  getStoredItem,
  hasCompletedStoredItems,
  listStoredItems,
  reorderStoredItems,
  requireUserEmail,
  updateStoredItem,
  updateStoredItemInTx,
} from "../stored-items/store.js";

export { requireUserEmail };

/** Action/UI view of a task on the task list (`promotedToTask = true` in storage). */
export type Task = Omit<StoredItem, "promotedToTask">;

export async function createTask(input: {
  ownerEmail: string;
  title: string;
  id?: string;
  now?: string;
}): Promise<Task> {
  const item = await createStoredItem({
    ownerEmail: input.ownerEmail,
    title: input.title,
    id: input.id ?? crypto.randomUUID(),
    now: input.now ?? new Date().toISOString(),
    promotedToTask: true,
  });
  return toTask(item);
}

export async function getTask(input: {
  ownerEmail: string;
  id: string;
}): Promise<Task | null> {
  const item = await getStoredItem({
    ...input,
    promotedToTask: true,
  });
  return item ? toTask(item) : null;
}

export async function listTasks(input: {
  ownerEmail: string;
  includeDone?: boolean;
}): Promise<Task[]> {
  const items = await listStoredItems({
    ...input,
    promotedToTask: true,
  });
  return items.map(toTask);
}

export async function hasCompletedTasks(input: {
  ownerEmail: string;
}): Promise<boolean> {
  return hasCompletedStoredItems({
    ownerEmail: input.ownerEmail,
    promotedToTask: true,
  });
}

export async function updateTask(input: {
  ownerEmail: string;
  id: string;
  title?: string;
  done?: boolean;
  now?: string;
}): Promise<Task> {
  const item = await updateStoredItem({
    ...input,
    promotedToTask: true,
  });
  return toTask(item);
}

export async function patchTask(input: {
  ownerEmail: string;
  id: string;
  title?: string;
  done?: boolean;
  fieldValues?: Array<{ fieldId: string; value: FieldValueInput }>;
  now?: string;
}): Promise<Task> {
  const hasTaskPatch = input.title !== undefined || input.done !== undefined;
  const hasFieldPatch = input.fieldValues !== undefined;

  if (!hasTaskPatch && !hasFieldPatch) {
    throw new Error("Provide at least one of title, done, or fieldValues.");
  }

  if (hasTaskPatch && hasFieldPatch) {
    await assertStoredItemsExist({
      ownerEmail: input.ownerEmail,
      ids: [input.id],
      promotedToTask: true,
      notFoundMessage: "Task not found.",
    });

    const patches = await prepareCustomFieldValuePatches({
      ownerEmail: input.ownerEmail,
      taskId: input.id,
      values: input.fieldValues!,
    });
    const timestamp = input.now ?? new Date().toISOString();

    await getDb().transaction(async (tx) => {
      await updateStoredItemInTx(tx, {
        ownerEmail: input.ownerEmail,
        id: input.id,
        promotedToTask: true,
        title: input.title,
        done: input.done,
        now: timestamp,
      });
      await applyCustomFieldValuePatchesInTx(tx, {
        ownerEmail: input.ownerEmail,
        taskId: input.id,
        patches,
        updatedAt: timestamp,
      });
    });

    const task = await getTask({ ownerEmail: input.ownerEmail, id: input.id });
    if (!task) throw new Error("Task not found.");
    return task;
  }

  if (hasTaskPatch) {
    return updateTask({
      ownerEmail: input.ownerEmail,
      id: input.id,
      title: input.title,
      done: input.done,
      now: input.now,
    });
  }

  const task = await getTask({ ownerEmail: input.ownerEmail, id: input.id });
  if (!task) throw new Error("Task not found.");

  await updateCustomFieldValues({
    ownerEmail: input.ownerEmail,
    taskId: input.id,
    values: input.fieldValues!,
    now: input.now,
  });
  return task;
}

export async function bulkUpdateTasks(input: {
  ownerEmail: string;
  taskIds: string[];
  title?: string;
  done?: boolean;
  now?: string;
}): Promise<Task[]> {
  if (input.title === undefined && input.done === undefined) {
    throw new Error("Provide at least one of title or done.");
  }

  await assertStoredItemsExist({
    ownerEmail: input.ownerEmail,
    ids: input.taskIds,
    promotedToTask: true,
    notFoundMessage: "Task not found.",
  });

  const timestamp = input.now ?? new Date().toISOString();
  await getDb().transaction(async (tx) => {
    for (const id of input.taskIds) {
      await updateStoredItemInTx(tx, {
        ownerEmail: input.ownerEmail,
        id,
        promotedToTask: true,
        title: input.title,
        done: input.done,
        now: timestamp,
      });
    }
  });

  const tasks = [];
  for (const id of input.taskIds) {
    const item = await getStoredItem({
      ownerEmail: input.ownerEmail,
      id,
      promotedToTask: true,
    });
    if (!item) throw new Error("Task not found.");
    tasks.push(toTask(item));
  }
  return tasks;
}

export async function deleteTask(input: {
  ownerEmail: string;
  id: string;
}): Promise<void> {
  await assertStoredItemsExist({
    ownerEmail: input.ownerEmail,
    ids: [input.id],
    promotedToTask: true,
    notFoundMessage: "Task not found.",
  });

  await getDb().transaction(async (tx) => {
    await deleteCustomFieldValues(
      { ownerEmail: input.ownerEmail, taskId: input.id },
      tx,
    );
    await deleteStoredItemInTx(tx, {
      ownerEmail: input.ownerEmail,
      id: input.id,
      promotedToTask: true,
    });
  });
}

export async function bulkDeleteTasks(input: {
  ownerEmail: string;
  taskIds: string[];
}): Promise<{ ok: true; deleted: number }> {
  await assertStoredItemsExist({
    ownerEmail: input.ownerEmail,
    ids: input.taskIds,
    promotedToTask: true,
    notFoundMessage: "Task not found.",
  });

  await getDb().transaction(async (tx) => {
    for (const id of input.taskIds) {
      await deleteCustomFieldValues(
        { ownerEmail: input.ownerEmail, taskId: id },
        tx,
      );
      await deleteStoredItemInTx(tx, {
        ownerEmail: input.ownerEmail,
        id,
        promotedToTask: true,
      });
    }
  });

  return { ok: true, deleted: input.taskIds.length };
}

export async function reorderTasks(input: {
  ownerEmail: string;
  taskIds: string[];
  includeDone?: boolean;
}): Promise<{ tasks: Task[] }> {
  const includeDone = input.includeDone === true;
  await reorderStoredItems({
    ownerEmail: input.ownerEmail,
    promotedToTask: true,
    orderedIds: input.taskIds,
    includeDone,
    idLabel: "taskIds",
  });

  const tasksAfter = await listTasks({
    ownerEmail: input.ownerEmail,
    includeDone,
  });
  return { tasks: tasksAfter };
}

export function toTask(item: StoredItem): Task {
  const { promotedToTask: _, ...task } = item;
  return task;
}
