import type { FieldValueInput } from "../custom-fields/types.js";
import {
  applyCustomFieldValuePatches,
  deleteCustomFieldValues,
  prepareCustomFieldValuePatches,
  updateCustomFieldValues,
} from "../custom-fields/values/store.js";
import { getDb } from "../db/index.js";
import type { StoredItem } from "../db/schema.js";
import type { DbHandle } from "../db/transaction.js";
import {
  assertStoredItemsExist,
  createStoredItem,
  deleteStoredItem,
  deleteStoredItemById,
  deleteStoredItemsByIds,
  getStoredItem,
  hasCompletedStoredItems,
  listStoredItems,
  listStoredItemsByIds,
  patchStoredItem,
  patchStoredItems,
  reorderStoredItems,
  requireUserEmail,
  updateStoredItem,
} from "../stored-items/store.js";

export { requireUserEmail };

/** Action/UI view of a task on the task list (`promotedToTask = true` in storage). */
export type Task = Omit<StoredItem, "promotedToTask">;

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
    includeDone?: boolean;
  },
  db: DbHandle = getDb(),
): Promise<Task[]> {
  const items = await listStoredItems(
    {
      ...input,
      promotedToTask: true,
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

export async function updateTask(
  input: {
    ownerEmail: string;
    id: string;
    title?: string;
    done?: boolean;
    now?: string;
  },
  db: DbHandle = getDb(),
): Promise<Task> {
  const item = await updateStoredItem(
    {
      ...input,
      promotedToTask: true,
    },
    db,
  );
  return toTask(item);
}

export async function patchTask(
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

  if (hasTaskPatch && hasFieldPatch) {
    await assertStoredItemsExist(
      {
        ownerEmail: input.ownerEmail,
        ids: [input.id],
        promotedToTask: true,
        notFoundMessage: "Task not found.",
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

    await db.transaction(async (tx) => {
      await patchStoredItem(
        {
          ownerEmail: input.ownerEmail,
          id: input.id,
          promotedToTask: true,
          title: input.title,
          done: input.done,
          now: timestamp,
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
    });

    const task = await getTask(
      { ownerEmail: input.ownerEmail, id: input.id },
      db,
    );
    if (!task) throw new Error("Task not found.");
    return task;
  }

  if (hasTaskPatch) {
    return updateTask(
      {
        ownerEmail: input.ownerEmail,
        id: input.id,
        title: input.title,
        done: input.done,
        now: input.now,
      },
      db,
    );
  }

  const task = await getTask(
    { ownerEmail: input.ownerEmail, id: input.id },
    db,
  );
  if (!task) throw new Error("Task not found.");

  await updateCustomFieldValues(
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

export async function bulkUpdateTasks(
  input: {
    ownerEmail: string;
    taskIds: string[];
    title?: string;
    done?: boolean;
    now?: string;
  },
  db: DbHandle = getDb(),
): Promise<Task[]> {
  if (input.title === undefined && input.done === undefined) {
    throw new Error("Provide at least one of title or done.");
  }

  const taskIds = [...new Set(input.taskIds)];
  await assertStoredItemsExist(
    {
      ownerEmail: input.ownerEmail,
      ids: taskIds,
      promotedToTask: true,
      notFoundMessage: "Task not found.",
    },
    db,
  );

  const timestamp = input.now ?? new Date().toISOString();
  await patchStoredItems(
    {
      ownerEmail: input.ownerEmail,
      ids: taskIds,
      promotedToTask: true,
      title: input.title,
      done: input.done,
      now: timestamp,
    },
    db,
  );

  const items = await listStoredItemsByIds(
    {
      ownerEmail: input.ownerEmail,
      ids: taskIds,
      promotedToTask: true,
      notFoundMessage: "Task not found.",
    },
    db,
  );
  return items.map(toTask);
}

export async function deleteTask(
  input: {
    ownerEmail: string;
    id: string;
  },
  db: DbHandle = getDb(),
): Promise<void> {
  await assertStoredItemsExist(
    {
      ownerEmail: input.ownerEmail,
      ids: [input.id],
      promotedToTask: true,
      notFoundMessage: "Task not found.",
    },
    db,
  );

  await db.transaction(async (tx) => {
    await deleteCustomFieldValues(
      { ownerEmail: input.ownerEmail, taskId: input.id },
      tx,
    );
    await deleteStoredItemById(
      {
        ownerEmail: input.ownerEmail,
        id: input.id,
        promotedToTask: true,
      },
      tx,
    );
  });
}

export async function bulkDeleteTasks(
  input: {
    ownerEmail: string;
    taskIds: string[];
  },
  db: DbHandle = getDb(),
): Promise<{ ok: true; deleted: number }> {
  const taskIds = [...new Set(input.taskIds)];
  await assertStoredItemsExist(
    {
      ownerEmail: input.ownerEmail,
      ids: taskIds,
      promotedToTask: true,
      notFoundMessage: "Task not found.",
    },
    db,
  );

  await db.transaction(async (tx) => {
    await deleteCustomFieldValues(
      { ownerEmail: input.ownerEmail, taskIds },
      tx,
    );
    await deleteStoredItemsByIds(
      {
        ownerEmail: input.ownerEmail,
        ids: taskIds,
        promotedToTask: true,
      },
      tx,
    );
  });

  return { ok: true, deleted: taskIds.length };
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
