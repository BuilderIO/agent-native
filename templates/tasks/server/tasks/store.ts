import {
  checkSaveRevision,
  countSaveOutcome,
  isSameRecord,
} from "@agent-native/core/save-conflict/server";

import {
  TASK_RECORD,
  taskRecordOf,
  type TaskRecord,
} from "../../shared/task-record.js";
import {
  getTaskWithFields,
  type TaskWithFields,
} from "../custom-fields/task-fields.js";
import type { FieldValueInput } from "../custom-fields/types.js";
import {
  applyCustomFieldValuePatches,
  deleteCustomFieldValuesByTaskIds,
  prepareCustomFieldValuePatches,
  type PreparedFieldValuePatch,
} from "../custom-fields/values/store.js";
import { getDb } from "../db/index.js";
import type { StoredItem } from "../db/schema.js";
import type { DbHandle } from "../db/transaction.js";
import { NotFoundError, UserInputError } from "../errors.js";
import {
  assertStoredItemsExist,
  createStoredItem,
  deleteStoredItems,
  getStoredItem,
  hasCompletedStoredItems,
  listStoredItems,
  lockStoredItem,
  lockStoredItems,
  reorderStoredItems,
  requireUserEmail,
  updateStoredItems,
} from "../stored-items/store.js";

export { requireUserEmail };

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
    throw new UserInputError("Provide at least one of title or done.");
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

export async function updateTask(
  input: {
    ownerEmail: string;
    id: string;
    title?: string | undefined;
    done?: boolean | undefined;
    fieldValues?:
      | Array<{ fieldId: string; value: FieldValueInput }>
      | undefined;
    expectedRevision?: string | undefined;
    now?: string;
  },
  db: DbHandle = getDb(),
): Promise<TaskWithFields> {
  if (
    input.title === undefined &&
    input.done === undefined &&
    input.fieldValues === undefined
  ) {
    throw new UserInputError(
      "Provide at least one of title, done, or fieldValues.",
    );
  }

  return db.transaction(async (tx) => {
    const locked = await lockStoredItem(
      { ownerEmail: input.ownerEmail, id: input.id, promotedToTask: true },
      tx,
    );
    if (!locked) throw new NotFoundError(NOT_FOUND);

    const patches = await prepareCustomFieldValuePatches(
      {
        ownerEmail: input.ownerEmail,
        taskId: input.id,
        values: input.fieldValues ?? [],
      },
      tx,
    );
    const current = await getTaskWithFields(
      { ownerEmail: input.ownerEmail, taskId: input.id },
      tx,
    );
    const decision = checkSaveRevision({
      record: TASK_RECORD,
      expectedRevision: input.expectedRevision,
      current: {
        value: taskRecordOf(current, current.fields),
        revision: current.revision,
      },
      isSameSave: (record) =>
        isSameRecord(withUpdate(record, input, patches), record),
    });
    if (decision === "already_applied") return current;

    const updatedAt = input.now ?? new Date().toISOString();
    if (input.title !== undefined || input.done !== undefined) {
      await updateStoredItems(
        {
          ownerEmail: input.ownerEmail,
          ids: [input.id],
          promotedToTask: true,
          title: input.title,
          done: input.done,
          now: updatedAt,
          notFoundMessage: NOT_FOUND,
        },
        tx,
      );
    }
    await applyCustomFieldValuePatches(
      {
        ownerEmail: input.ownerEmail,
        taskId: input.id,
        patches,
        updatedAt,
      },
      tx,
    );
    countSaveOutcome(TASK_RECORD, "written");
    return getTaskWithFields(
      { ownerEmail: input.ownerEmail, taskId: input.id },
      tx,
    );
  });
}

function withUpdate(
  record: TaskRecord,
  update: { title?: string | undefined; done?: boolean | undefined },
  patches: Map<string, PreparedFieldValuePatch>,
): TaskRecord {
  const fields = { ...record.fields };
  for (const [fieldId, patch] of patches) {
    if (patch.value === null) delete fields[fieldId];
    else fields[fieldId] = patch.value;
  }
  return {
    title: update.title?.trim() ?? record.title,
    done: update.done ?? record.done,
    fields,
  };
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
    await lockStoredItems(
      { ownerEmail: input.ownerEmail, ids, promotedToTask: true },
      tx,
    );
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
