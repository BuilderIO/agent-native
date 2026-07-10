import type { StoredItem } from "../db/schema.js";
import { deleteCustomFieldValues } from "../custom-fields/values/store.js";
import {
  createStoredItem,
  getStoredItem,
  listStoredItems,
  updateStoredItem,
  deleteStoredItem,
  reorderStoredItems,
  requireUserEmail,
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

export async function deleteTask(input: {
  ownerEmail: string;
  id: string;
}): Promise<void> {
  deleteCustomFieldValues({
    ownerEmail: input.ownerEmail,
    taskId: input.id,
  });
  await deleteStoredItem({ ...input, promotedToTask: true });
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
