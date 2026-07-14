import type { FieldValueInput } from "../custom-fields/types.js";
import {
  applyCustomFieldValuePatches,
  deleteCustomFieldValuesByTaskIds,
  prepareCustomFieldValuePatches,
  updateCustomFieldValuesByTaskId,
} from "../custom-fields/values/store.js";
import { getDb } from "../db/index.js";
import type { StoredItem } from "../db/schema.js";
import type { DbHandle } from "../db/transaction.js";
import {
  assertStoredItemsExist,
  createStoredItem,
  deleteStoredItems,
  getStoredItem,
  hasCompletedStoredItems,
  listStoredItems,
  reorderStoredItems,
  requireUserEmail,
  updateStoredItems,
} from "../stored-items/store.js";

export { requireUserEmail };

/** Action/UI view of a task on the task list (`promotedToTask = true` in storage). */
export type Task = Omit<StoredItem, "promotedToTask">;

const NOT_FOUND = "Task not found.";

export async function createTask(
  input: {
    ownerEmail: string;
    title: string;
    id?: string;
    now?: string;
  },
  db: DbHandle = getDb(),
): Promise<Task> {
  const item = await createStoredItem(
    {
      ownerEmail: input.ownerEmail,
      title: input.title,
      id: input.id ?? crypto.randomUUID(),
      now: input.now ?? new Date().toISOString(),
      promotedToTask: true,
    },
    db,
  );
  return toTask(item);
}

export async function getTask(
  input: {
    ownerEmail: string;
    id: string;
  },
  db: DbHandle = getDb(),
): Promise<Task | null> {
  const item = await getStoredItem(
    {
      ...input,
      promotedToTask: true,
    },
    db,
  );
  return item ? toTask(item) : null;
}

export async function listTasks(
  input: {
    ownerEmail: string;
    ids?: string[];
    includeDone?: boolean;
  },
  db: DbHandle = getDb(),
): Promise<Task[]> {
  const items = await listStoredItems(
    {
      ...input,
      promotedToTask: true,
      notFoundMessage: NOT_FOUND,
    },
    db,
  );
  return items.map(toTask);
}

export async function hasCompletedTasks(
  input: {
    ownerEmail: string;
  },
  db: DbHandle = getDb(),
): Promise<boolean> {
  return hasCompletedStoredItems(
    {
      ownerEmail: input.ownerEmail,
      promotedToTask: true,
    },
    db,
  );
}

export async function updateTasks(
  input: {
    ownerEmail: string;
    ids: string[];
    title?: string;
    done?: boolean;
    now?: string;
  },
  db: DbHandle = getDb(),
): Promise<Task[]> {
  if (input.title === undefined && input.done === undefined) {
    throw new Error("Provide at least one of title or done.");
  }

  const items = await updateStoredItems(
    {
      ...input,
      promotedToTask: true,
      notFoundMessage: NOT_FOUND,
    },
    db,
  );
  return items.map(toTask);
}

/**
 * Single-task update. Unlike `updateTasks` this also accepts `fieldValues`,
 * which are per-task and so have no meaningful bulk form.
 */
export async function updateTask(
  input: {
    ownerEmail: string;
    id: string;
    title?: string;
    done?: boolean;
    fieldValues?: Array<{ fieldId: string; value: FieldValueInput }>;
    now?: string;
  },
  db: DbHandle = getDb(),
): Promise<Task> {
  const hasTaskPatch = input.title !== undefined || input.done !== undefined;
  const hasFieldPatch = input.fieldValues !== undefined;

  if (!hasTaskPatch && !hasFieldPatch) {
    throw new Error("Provide at least one of title, done, or fieldValues.");
  }

  if (!hasFieldPatch) {
    const [task] = await updateTasks({ ...input, ids: [input.id] }, db);
    if (!task) throw new Error(NOT_FOUND);
    return task;
  }

  if (!hasTaskPatch) {
    const task = await getTask(
      { ownerEmail: input.ownerEmail, id: input.id },
      db,
    );
    if (!task) throw new Error(NOT_FOUND);

    await updateCustomFieldValuesByTaskId(
      {
        ownerEmail: input.ownerEmail,
        taskId: input.id,
        values: input.fieldValues!,
        now: input.now,
      },
      db,
    );
    return task;
  }

  await assertStoredItemsExist(
    {
      ownerEmail: input.ownerEmail,
      ids: [input.id],
      promotedToTask: true,
      notFoundMessage: NOT_FOUND,
    },
    db,
  );

  const patches = await prepareCustomFieldValuePatches(
    {
      ownerEmail: input.ownerEmail,
      taskId: input.id,
      values: input.fieldValues!,
    },
    db,
  );
  const timestamp = input.now ?? new Date().toISOString();

  const task = await db.transaction(async (tx) => {
    const [item] = await updateStoredItems(
      {
        ownerEmail: input.ownerEmail,
        ids: [input.id],
        promotedToTask: true,
        title: input.title,
        done: input.done,
        now: timestamp,
        notFoundMessage: NOT_FOUND,
      },
      tx,
    );
    await applyCustomFieldValuePatches(
      {
        ownerEmail: input.ownerEmail,
        taskId: input.id,
        patches,
        updatedAt: timestamp,
      },
      tx,
    );
    return item ? toTask(item) : null;
  });

  if (!task) throw new Error(NOT_FOUND);
  return task;
}

export async function deleteTasks(
  input: {
    ownerEmail: string;
    ids: string[];
  },
  db: DbHandle = getDb(),
): Promise<{ ok: true; deleted: number }> {
  const ids = [...new Set(input.ids)];
  await assertStoredItemsExist(
    {
      ownerEmail: input.ownerEmail,
      ids,
      promotedToTask: true,
      notFoundMessage: NOT_FOUND,
    },
    db,
  );

  await db.transaction(async (tx) => {
    await deleteCustomFieldValuesByTaskIds(
      { ownerEmail: input.ownerEmail, taskIds: ids },
      tx,
    );
    await deleteStoredItems(
      {
        ownerEmail: input.ownerEmail,
        ids,
        promotedToTask: true,
      },
      tx,
    );
  });

  return { ok: true, deleted: ids.length };
}

export async function deleteTask(
  input: {
    ownerEmail: string;
    id: string;
  },
  db: DbHandle = getDb(),
): Promise<void> {
  await deleteTasks({ ownerEmail: input.ownerEmail, ids: [input.id] }, db);
}

export async function reorderTasks(
  input: {
    ownerEmail: string;
    taskIds: string[];
    includeDone?: boolean;
  },
  db: DbHandle = getDb(),
): Promise<{ tasks: Task[] }> {
  const includeDone = input.includeDone === true;
  await reorderStoredItems(
    {
      ownerEmail: input.ownerEmail,
      promotedToTask: true,
      orderedIds: input.taskIds,
      includeDone,
      idLabel: "taskIds",
    },
    db,
  );

  const tasksAfter = await listTasks(
    {
      ownerEmail: input.ownerEmail,
      includeDone,
    },
    db,
  );
  return { tasks: tasksAfter };
}

export function toTask(item: StoredItem): Task {
  const { promotedToTask: _, ...task } = item;
  return task;
}
