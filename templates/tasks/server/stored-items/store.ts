import { and, asc, eq, min } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { tasks, type StoredItem } from "../db/schema.js";
import type { DbHandle } from "../db/transaction.js";

/**
 * Storage layer on the unified `tasks` table.
 * All methods take `promotedToTask`; there is no inbox/task split at this layer.
 */

export type { StoredItem };

const SORT_GAP = 1000;

export function requireUserEmail(email: string | undefined): string {
  if (!email) {
    throw new Error("Authentication required.");
  }
  return email;
}

export async function createStoredItem(input: {
  ownerEmail: string;
  title: string;
  id: string;
  now: string;
  promotedToTask: boolean;
}): Promise<StoredItem> {
  const title = assertNonEmptyTitle(input.title, "Title is required.");
  const db = getDb();
  const sortOrder = await nextSortOrderForNewItem(
    input.ownerEmail,
    input.promotedToTask,
  );

  await db.insert(tasks).values({
    id: input.id,
    title,
    done: false,
    promotedToTask: input.promotedToTask,
    sortOrder,
    ownerEmail: input.ownerEmail,
    createdAt: input.now,
    updatedAt: input.now,
  });

  const item = await getStoredItem({
    ownerEmail: input.ownerEmail,
    id: input.id,
    promotedToTask: input.promotedToTask,
  });
  if (!item) {
    throw new Error("Failed to create stored item.");
  }
  return item;
}

export async function getStoredItem(input: {
  ownerEmail: string;
  id: string;
  promotedToTask?: boolean;
}): Promise<StoredItem | null> {
  const conditions = [
    eq(tasks.id, input.id),
    eq(tasks.ownerEmail, input.ownerEmail),
  ];
  if (input.promotedToTask !== undefined) {
    conditions.push(eq(tasks.promotedToTask, input.promotedToTask));
  }

  const db = getDb();
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(...conditions))
    .limit(1);
  return row ?? null;
}

export async function hasCompletedStoredItems(input: {
  ownerEmail: string;
  promotedToTask: boolean;
}): Promise<boolean> {
  if (!input.promotedToTask) {
    return false;
  }

  const db = getDb();
  const [row] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.ownerEmail, input.ownerEmail),
        eq(tasks.promotedToTask, true),
        eq(tasks.done, true),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function listStoredItems(input: {
  ownerEmail: string;
  promotedToTask: boolean;
  includeDone?: boolean;
}): Promise<StoredItem[]> {
  const db = getDb();
  const filters = [
    eq(tasks.ownerEmail, input.ownerEmail),
    eq(tasks.promotedToTask, input.promotedToTask),
  ];
  if (input.promotedToTask && !input.includeDone) {
    filters.push(eq(tasks.done, false));
  }

  return db
    .select()
    .from(tasks)
    .where(and(...filters))
    .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt));
}

export async function updateStoredItem(input: {
  ownerEmail: string;
  id: string;
  promotedToTask: boolean;
  title?: string;
  done?: boolean;
  now?: string;
}): Promise<StoredItem> {
  const existing = await getStoredItem({
    ownerEmail: input.ownerEmail,
    id: input.id,
    promotedToTask: input.promotedToTask,
  });

  if (!existing) {
    throw new Error("Stored item not found.");
  }

  const hasTitle = input.title !== undefined;
  const hasDone = input.promotedToTask && input.done !== undefined;
  if (!hasTitle && !hasDone) {
    return existing;
  }

  const patch: Partial<typeof tasks.$inferInsert> = {
    updatedAt: input.now ?? new Date().toISOString(),
  };

  if (hasTitle) {
    patch.title = assertNonEmptyTitle(input.title!, "Title cannot be empty.");
  }

  if (hasDone) {
    patch.done = input.done;
  }

  const db = getDb();
  await db
    .update(tasks)
    .set(patch)
    .where(
      and(
        eq(tasks.id, input.id),
        eq(tasks.ownerEmail, input.ownerEmail),
        eq(tasks.promotedToTask, input.promotedToTask),
      ),
    );

  const item = await getStoredItem({
    ownerEmail: input.ownerEmail,
    id: input.id,
    promotedToTask: input.promotedToTask,
  });
  if (!item) {
    throw new Error("Stored item not found.");
  }
  return item;
}

export async function deleteStoredItem(input: {
  ownerEmail: string;
  id: string;
  promotedToTask: boolean;
}): Promise<void> {
  const existing = await getStoredItem(input);
  if (!existing) {
    throw new Error("Stored item not found.");
  }

  const db = getDb();
  await db
    .delete(tasks)
    .where(
      and(
        eq(tasks.id, input.id),
        eq(tasks.ownerEmail, input.ownerEmail),
        eq(tasks.promotedToTask, input.promotedToTask),
      ),
    );
}

export async function assertStoredItemsExist(input: {
  ownerEmail: string;
  ids: string[];
  promotedToTask: boolean;
  notFoundMessage?: string;
}): Promise<void> {
  for (const id of input.ids) {
    const item = await getStoredItem({
      ownerEmail: input.ownerEmail,
      id,
      promotedToTask: input.promotedToTask,
    });
    if (!item) {
      throw new Error(input.notFoundMessage ?? "Stored item not found.");
    }
  }
}

export async function updateStoredItemInTx(
  tx: DbHandle,
  input: {
    ownerEmail: string;
    id: string;
    promotedToTask: boolean;
    title?: string;
    done?: boolean;
    now: string;
  },
): Promise<void> {
  const patch: Partial<typeof tasks.$inferInsert> = {
    updatedAt: input.now,
  };

  if (input.title !== undefined) {
    patch.title = assertNonEmptyTitle(input.title, "Title cannot be empty.");
  }

  if (input.promotedToTask && input.done !== undefined) {
    patch.done = input.done;
  }

  await tx
    .update(tasks)
    .set(patch)
    .where(
      and(
        eq(tasks.id, input.id),
        eq(tasks.ownerEmail, input.ownerEmail),
        eq(tasks.promotedToTask, input.promotedToTask),
      ),
    );
}

export async function deleteStoredItemInTx(
  tx: DbHandle,
  input: {
    ownerEmail: string;
    id: string;
    promotedToTask: boolean;
  },
): Promise<void> {
  await tx
    .delete(tasks)
    .where(
      and(
        eq(tasks.id, input.id),
        eq(tasks.ownerEmail, input.ownerEmail),
        eq(tasks.promotedToTask, input.promotedToTask),
      ),
    );
}

export async function reorderStoredItems(input: {
  ownerEmail: string;
  promotedToTask: boolean;
  orderedIds: string[];
  includeDone?: boolean;
  idLabel?: string;
}): Promise<void> {
  const idLabel =
    input.idLabel ?? (input.promotedToTask ? "taskIds" : "inboxItemIds");
  const visibleItems = await listStoredItems({
    ownerEmail: input.ownerEmail,
    promotedToTask: input.promotedToTask,
    includeDone: input.includeDone,
  });
  const visibleIds = new Set(visibleItems.map((item) => item.id));
  validateVisibleReorder(input.orderedIds, visibleIds, idLabel);

  if (!input.promotedToTask) {
    await applySortOrderUpdates(input);
    return;
  }

  const db = getDb();
  const allPromotedItems = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.ownerEmail, input.ownerEmail),
        eq(tasks.promotedToTask, true),
      ),
    )
    .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt));

  const visibleQueue = [...input.orderedIds];
  const merged = allPromotedItems.map((item) => {
    if (!visibleIds.has(item.id)) return item;
    const nextId = visibleQueue.shift();
    if (!nextId) {
      throw new Error(
        `${idLabel} must include every visible item exactly once.`,
      );
    }
    const nextItem = allPromotedItems.find(
      (candidate) => candidate.id === nextId,
    );
    if (!nextItem) {
      throw new Error("Stored item not found.");
    }
    return nextItem;
  });

  const timestamp = new Date().toISOString();
  await db.transaction(async (tx) => {
    for (let index = 0; index < merged.length; index += 1) {
      const item = merged[index];
      if (!item) continue;
      await tx
        .update(tasks)
        .set({ sortOrder: index * SORT_GAP, updatedAt: timestamp })
        .where(
          and(
            eq(tasks.id, item.id),
            eq(tasks.ownerEmail, input.ownerEmail),
            eq(tasks.promotedToTask, true),
          ),
        );
    }
  });
}

function validateVisibleReorder(
  orderedIds: string[],
  visibleIds: Set<string>,
  idLabel: string,
): void {
  if (orderedIds.length !== visibleIds.size) {
    throw new Error(`${idLabel} must include every visible item exactly once.`);
  }

  if (!orderedIds.every((id) => visibleIds.has(id))) {
    throw new Error(`${idLabel} must match the current visible list.`);
  }

  if (new Set(orderedIds).size !== orderedIds.length) {
    throw new Error(`${idLabel} must not contain duplicates.`);
  }
}

async function applySortOrderUpdates(input: {
  ownerEmail: string;
  promotedToTask: boolean;
  orderedIds: string[];
}): Promise<void> {
  const timestamp = new Date().toISOString();
  await getDb().transaction(async (tx) => {
    for (let index = 0; index < input.orderedIds.length; index += 1) {
      const id = input.orderedIds[index];
      if (!id) continue;
      await tx
        .update(tasks)
        .set({ sortOrder: index * SORT_GAP, updatedAt: timestamp })
        .where(
          and(
            eq(tasks.id, id),
            eq(tasks.ownerEmail, input.ownerEmail),
            eq(tasks.promotedToTask, input.promotedToTask),
          ),
        );
    }
  });
}

/** Set `promotedToTask` from false → true on an existing stored item (same id). */
export async function promoteStoredItemToTask(input: {
  ownerEmail: string;
  id: string;
  now?: string;
}): Promise<StoredItem> {
  const existing = await getStoredItem({
    ownerEmail: input.ownerEmail,
    id: input.id,
    promotedToTask: false,
  });

  if (!existing) {
    throw new Error("Stored item not found.");
  }

  const timestamp = input.now ?? new Date().toISOString();
  const sortOrder = await nextSortOrderForNewItem(input.ownerEmail, true);

  const db = getDb();
  await db
    .update(tasks)
    .set({
      promotedToTask: true,
      done: false,
      sortOrder,
      updatedAt: timestamp,
    })
    .where(
      and(
        eq(tasks.id, input.id),
        eq(tasks.ownerEmail, input.ownerEmail),
        eq(tasks.promotedToTask, false),
      ),
    );

  const item = await getStoredItem({
    ownerEmail: input.ownerEmail,
    id: input.id,
    promotedToTask: true,
  });
  if (!item) {
    throw new Error("Stored item not found.");
  }
  return item;
}

export async function bulkPromoteStoredItemsToTasks(input: {
  ownerEmail: string;
  ids: string[];
  now?: string;
}): Promise<StoredItem[]> {
  const uniqueIds = [...new Set(input.ids)];
  if (uniqueIds.length === 0) {
    throw new Error("Provide at least one inbox item id.");
  }

  await assertStoredItemsExist({
    ownerEmail: input.ownerEmail,
    ids: uniqueIds,
    promotedToTask: false,
    notFoundMessage: "Stored item not found.",
  });

  const timestamp = input.now ?? new Date().toISOString();
  let sortOrder = await nextSortOrderForNewItem(input.ownerEmail, true);

  await getDb().transaction(async (tx) => {
    for (const id of uniqueIds) {
      await tx
        .update(tasks)
        .set({
          promotedToTask: true,
          done: false,
          sortOrder,
          updatedAt: timestamp,
        })
        .where(
          and(
            eq(tasks.id, id),
            eq(tasks.ownerEmail, input.ownerEmail),
            eq(tasks.promotedToTask, false),
          ),
        );
      sortOrder -= SORT_GAP;
    }
  });

  const items: StoredItem[] = [];
  for (const id of uniqueIds) {
    const item = await getStoredItem({
      ownerEmail: input.ownerEmail,
      id,
      promotedToTask: true,
    });
    if (!item) {
      throw new Error("Stored item not found.");
    }
    items.push(item);
  }
  return items;
}

function assertNonEmptyTitle(title: string, emptyMessage: string): string {
  const trimmed = title.trim();
  if (!trimmed) {
    throw new Error(emptyMessage);
  }
  return trimmed;
}

async function nextSortOrderForNewItem(
  ownerEmail: string,
  promotedToTask: boolean,
): Promise<number> {
  const minSort = await minSortOrderForOwner(ownerEmail, promotedToTask);
  if (minSort == null) return 0;
  return minSort - SORT_GAP;
}

async function minSortOrderForOwner(
  ownerEmail: string,
  promotedToTask: boolean,
): Promise<number | null> {
  const db = getDb();
  const [row] = await db
    .select({ minSort: min(tasks.sortOrder) })
    .from(tasks)
    .where(
      and(
        eq(tasks.ownerEmail, ownerEmail),
        eq(tasks.promotedToTask, promotedToTask),
      ),
    );

  return row?.minSort ?? null;
}
