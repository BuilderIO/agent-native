import { getDb } from "../db/index.js";
import type { StoredItem } from "../db/schema.js";
import type { DbHandle } from "../db/transaction.js";
import {
  assertStoredItemsExist,
  createStoredItem,
  deleteStoredItems,
  getStoredItem,
  listStoredItems,
  promoteStoredItemsToTasks,
  reorderStoredItems,
  requireUserEmail,
  updateStoredItems,
} from "../stored-items/store.js";
import { type Task, toTask } from "../tasks/store.js";

export { requireUserEmail };

/** Action/UI view of an inbox item (`promotedToTask = false` in storage). */
export type InboxItem = Omit<StoredItem, "promotedToTask" | "done">;

const NOT_FOUND = "Stored item not found.";

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
    ids?: string[];
  },
  db: DbHandle = getDb(),
): Promise<InboxItem[]> {
  const items = await listStoredItems(
    {
      ...input,
      promotedToTask: false,
      notFoundMessage: NOT_FOUND,
    },
    db,
  );
  return items.map(toInboxItem);
}

export async function updateInboxItems(
  input: {
    ownerEmail: string;
    ids: string[];
    title?: string;
    now?: string;
  },
  db: DbHandle = getDb(),
): Promise<InboxItem[]> {
  const items = await updateStoredItems(
    {
      ...input,
      promotedToTask: false,
      notFoundMessage: NOT_FOUND,
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
  const [item] = await updateInboxItems({ ...input, ids: [input.id] }, db);
  if (!item) throw new Error(NOT_FOUND);
  return item;
}

export async function deleteInboxItems(
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
      promotedToTask: false,
      notFoundMessage: NOT_FOUND,
    },
    db,
  );

  await deleteStoredItems(
    {
      ownerEmail: input.ownerEmail,
      ids,
      promotedToTask: false,
    },
    db,
  );

  return { ok: true, deleted: ids.length };
}

export async function deleteInboxItem(
  input: {
    ownerEmail: string;
    id: string;
  },
  db: DbHandle = getDb(),
): Promise<void> {
  await deleteInboxItems({ ownerEmail: input.ownerEmail, ids: [input.id] }, db);
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

export async function markInboxItemsReady(
  input: {
    ownerEmail: string;
    ids: string[];
    now?: string;
  },
  db: DbHandle = getDb(),
): Promise<{ tasks: Task[] }> {
  const items = await promoteStoredItemsToTasks(
    {
      ownerEmail: input.ownerEmail,
      ids: input.ids,
      now: input.now,
    },
    db,
  );
  return { tasks: items.map(toTask) };
}

export async function markInboxItemReady(
  input: {
    ownerEmail: string;
    id: string;
    now?: string;
  },
  db: DbHandle = getDb(),
): Promise<{ task: Task }> {
  const { tasks } = await markInboxItemsReady(
    { ownerEmail: input.ownerEmail, ids: [input.id], now: input.now },
    db,
  );
  const task = tasks[0];
  if (!task) throw new Error(NOT_FOUND);
  return { task };
}

function toInboxItem(item: StoredItem): InboxItem {
  const { promotedToTask: _, done: __, ...inboxItem } = item;
  return inboxItem;
}
