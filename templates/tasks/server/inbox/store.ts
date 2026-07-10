import type { StoredItem } from "../db/schema.js";
import { type Task, toTask } from "../tasks/store.js";
import {
  createStoredItem,
  getStoredItem,
  listStoredItems,
  updateStoredItem,
  deleteStoredItem,
  reorderStoredItems,
  promoteStoredItemToTask,
  requireUserEmail,
} from "../stored-items/store.js";

export { requireUserEmail };

/** Action/UI view of an inbox item (`promotedToTask = false` in storage). */
export type InboxItem = Omit<StoredItem, "promotedToTask" | "done">;

export async function createInboxItem(input: {
  ownerEmail: string;
  title: string;
  id?: string;
  now?: string;
}): Promise<InboxItem> {
  const item = await createStoredItem({
    ownerEmail: input.ownerEmail,
    title: input.title,
    id: input.id ?? crypto.randomUUID(),
    now: input.now ?? new Date().toISOString(),
    promotedToTask: false,
  });
  return toInboxItem(item);
}

export async function getInboxItem(input: {
  ownerEmail: string;
  id: string;
}): Promise<InboxItem | null> {
  const item = await getStoredItem({
    ...input,
    promotedToTask: false,
  });
  return item ? toInboxItem(item) : null;
}

export async function listInboxItems(input: {
  ownerEmail: string;
}): Promise<InboxItem[]> {
  const items = await listStoredItems({
    ...input,
    promotedToTask: false,
  });
  return items.map(toInboxItem);
}

export async function updateInboxItem(input: {
  ownerEmail: string;
  id: string;
  title?: string;
  now?: string;
}): Promise<InboxItem> {
  const item = await updateStoredItem({
    ...input,
    promotedToTask: false,
  });
  return toInboxItem(item);
}

export async function deleteInboxItem(input: {
  ownerEmail: string;
  id: string;
}): Promise<void> {
  await deleteStoredItem({ ...input, promotedToTask: false });
}

export async function reorderInboxItems(input: {
  ownerEmail: string;
  inboxItemIds: string[];
}): Promise<{ items: InboxItem[] }> {
  await reorderStoredItems({
    ownerEmail: input.ownerEmail,
    promotedToTask: false,
    orderedIds: input.inboxItemIds,
    idLabel: "inboxItemIds",
  });

  const items = await listInboxItems({ ownerEmail: input.ownerEmail });
  return { items };
}

export async function markInboxItemReady(input: {
  ownerEmail: string;
  id: string;
  now?: string;
}): Promise<{ task: Task }> {
  const item = await promoteStoredItemToTask(input);
  return { task: toTask(item) };
}

function toInboxItem(item: StoredItem): InboxItem {
  const { promotedToTask: _, done: __, ...inboxItem } = item;
  return inboxItem;
}
