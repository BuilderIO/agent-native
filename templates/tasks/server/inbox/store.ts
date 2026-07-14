import { getDb } from "../db/index.js";
import type { StoredItem } from "../db/schema.js";
import type { DbHandle } from "../db/transaction.js";
import {
  assertStoredItemsExist,
  bulkPromoteStoredItemsToTasks,
  createStoredItem,
  deleteStoredItem,
  deleteStoredItemsByIds,
  getStoredItem,
  listStoredItems,
  promoteStoredItemToTask,
  reorderStoredItems,
  requireUserEmail,
  updateStoredItem,
} from "../stored-items/store.js";
import { type Task, toTask } from "../tasks/store.js";

export { requireUserEmail };

/** Action/UI view of an inbox item (`promotedToTask = false` in storage). */
export type InboxItem = Omit<StoredItem, "promotedToTask" | "done">;

export async function createInboxItem(
  input: {
    ownerEmail: string;
    title: string;
    id?: string;
    now?: string;
  },
  db: DbHandle = getDb(),
): Promise<InboxItem> {
  const item = await createStoredItem(
    {
      ownerEmail: input.ownerEmail,
      title: input.title,
      id: input.id ?? crypto.randomUUID(),
      now: input.now ?? new Date().toISOString(),
      promotedToTask: false,
    },
    db,
  );
  return toInboxItem(item);
}

export async function getInboxItem(
  input: {
    ownerEmail: string;
    id: string;
  },
  db: DbHandle = getDb(),
): Promise<InboxItem | null> {
  const item = await getStoredItem(
    {
      ...input,
      promotedToTask: false,
    },
    db,
  );
  return item ? toInboxItem(item) : null;
}

export async function listInboxItems(
  input: {
    ownerEmail: string;
  },
  db: DbHandle = getDb(),
): Promise<InboxItem[]> {
  const items = await listStoredItems(
    {
      ...input,
      promotedToTask: false,
    },
    db,
  );
  return items.map(toInboxItem);
}

export async function updateInboxItem(
  input: {
    ownerEmail: string;
    id: string;
    title?: string;
    now?: string;
  },
  db: DbHandle = getDb(),
): Promise<InboxItem> {
  const item = await updateStoredItem(
    {
      ...input,
      promotedToTask: false,
    },
    db,
  );
  return toInboxItem(item);
}

export async function deleteInboxItem(
  input: {
    ownerEmail: string;
    id: string;
  },
  db: DbHandle = getDb(),
): Promise<void> {
  await deleteStoredItem({ ...input, promotedToTask: false }, db);
}

export async function bulkDeleteInboxItems(
  input: {
    ownerEmail: string;
    inboxItemIds: string[];
  },
  db: DbHandle = getDb(),
): Promise<{ ok: true; deleted: number }> {
  const inboxItemIds = [...new Set(input.inboxItemIds)];
  await assertStoredItemsExist(
    {
      ownerEmail: input.ownerEmail,
      ids: inboxItemIds,
      promotedToTask: false,
      notFoundMessage: "Stored item not found.",
    },
    db,
  );

  await deleteStoredItemsByIds(
    {
      ownerEmail: input.ownerEmail,
      ids: inboxItemIds,
      promotedToTask: false,
    },
    db,
  );

  return { ok: true, deleted: inboxItemIds.length };
}

export async function reorderInboxItems(
  input: {
    ownerEmail: string;
    inboxItemIds: string[];
  },
  db: DbHandle = getDb(),
): Promise<{ items: InboxItem[] }> {
  await reorderStoredItems(
    {
      ownerEmail: input.ownerEmail,
      promotedToTask: false,
      orderedIds: input.inboxItemIds,
      idLabel: "inboxItemIds",
    },
    db,
  );

  const items = await listInboxItems({ ownerEmail: input.ownerEmail }, db);
  return { items };
}

export async function markInboxItemReady(
  input: {
    ownerEmail: string;
    id: string;
    now?: string;
  },
  db: DbHandle = getDb(),
): Promise<{ task: Task }> {
  const item = await promoteStoredItemToTask(input, db);
  return { task: toTask(item) };
}

export async function bulkMarkInboxItemsReady(
  input: {
    ownerEmail: string;
    inboxItemIds: string[];
    now?: string;
  },
  db: DbHandle = getDb(),
): Promise<{ tasks: Task[] }> {
  const items = await bulkPromoteStoredItemsToTasks(
    {
      ownerEmail: input.ownerEmail,
      ids: input.inboxItemIds,
      now: input.now,
    },
    db,
  );
  return { tasks: items.map(toTask) };
}

function toInboxItem(item: StoredItem): InboxItem {
  const { promotedToTask: _, done: __, ...inboxItem } = item;
  return inboxItem;
}
