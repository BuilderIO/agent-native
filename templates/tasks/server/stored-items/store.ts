import { and, asc, eq, inArray, min } from "drizzle-orm";

import { caseById, chunk } from "../db/bulk-write.js";
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

export async function createStoredItem(
  input: {
    ownerEmail: string;
    title: string;
    id: string;
    now: string;
    promotedToTask: boolean;
  },
  db: DbHandle = getDb(),
): Promise<StoredItem> {
  const title = assertNonEmptyTitle(input.title, "Title is required.");
  const sortOrder = await nextSortOrderForNewItem(
    input.ownerEmail,
    input.promotedToTask,
    db,
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

  const item = await getStoredItem(
    {
      ownerEmail: input.ownerEmail,
      id: input.id,
      promotedToTask: input.promotedToTask,
    },
    db,
  );
  if (!item) {
    throw new Error("Failed to create stored item.");
  }
  return item;
}

export async function getStoredItem(
  input: {
    ownerEmail: string;
    id: string;
    promotedToTask?: boolean;
  },
  db: DbHandle = getDb(),
): Promise<StoredItem | null> {
  const conditions = [
    eq(tasks.id, input.id),
    eq(tasks.ownerEmail, input.ownerEmail),
  ];
  if (input.promotedToTask !== undefined) {
    conditions.push(eq(tasks.promotedToTask, input.promotedToTask));
  }

  const [row] = await db
    .select()
    .from(tasks)
    .where(and(...conditions))
    .limit(1);
  return row ?? null;
}

export async function hasCompletedStoredItems(
  input: {
    ownerEmail: string;
    promotedToTask: boolean;
  },
  db: DbHandle = getDb(),
): Promise<boolean> {
  if (!input.promotedToTask) {
    return false;
  }

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

export async function listStoredItems(
  input: {
    ownerEmail: string;
    promotedToTask: boolean;
    ids?: string[];
    includeDone?: boolean;
    notFoundMessage?: string;
  },
  db: DbHandle = getDb(),
): Promise<StoredItem[]> {
  const ids = input.ids ? [...new Set(input.ids)] : undefined;
  if (ids?.length === 0) return [];

  const filters = [
    eq(tasks.ownerEmail, input.ownerEmail),
    eq(tasks.promotedToTask, input.promotedToTask),
  ];
  if (ids) {
    filters.push(inArray(tasks.id, ids));
  } else if (input.promotedToTask && !input.includeDone) {
    filters.push(eq(tasks.done, false));
  }

  const rows = await db
    .select()
    .from(tasks)
    .where(and(...filters))
    .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt));

  if (!ids) return rows;

  const rowsById = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => {
    const row = rowsById.get(id);
    if (!row) {
      throw new Error(input.notFoundMessage ?? "Stored item not found.");
    }
    return row;
  });
}

export async function updateStoredItems(
  input: {
    ownerEmail: string;
    ids: string[];
    promotedToTask: boolean;
    title?: string;
    done?: boolean;
    now?: string;
    notFoundMessage?: string;
  },
  db: DbHandle = getDb(),
): Promise<StoredItem[]> {
  const ids = [...new Set(input.ids)];
  if (ids.length === 0) return [];

  const read = {
    ownerEmail: input.ownerEmail,
    ids,
    promotedToTask: input.promotedToTask,
    notFoundMessage: input.notFoundMessage,
  };

  const hasTitle = input.title !== undefined;
  const hasDone = input.promotedToTask && input.done !== undefined;
  if (!hasTitle && !hasDone) {
    return listStoredItems(read, db);
  }

  await assertStoredItemsExist(read, db);

  const patch: Partial<typeof tasks.$inferInsert> = {
    updatedAt: input.now ?? new Date().toISOString(),
  };
  if (hasTitle) {
    patch.title = assertNonEmptyTitle(input.title!, "Title cannot be empty.");
  }
  if (hasDone) {
    patch.done = input.done;
  }

  await db
    .update(tasks)
    .set(patch)
    .where(
      and(
        eq(tasks.ownerEmail, input.ownerEmail),
        eq(tasks.promotedToTask, input.promotedToTask),
        inArray(tasks.id, ids),
      ),
    );

  return listStoredItems(read, db);
}

export async function updateStoredItem(
  input: {
    ownerEmail: string;
    id: string;
    promotedToTask: boolean;
    title?: string;
    done?: boolean;
    now?: string;
    notFoundMessage?: string;
  },
  db: DbHandle = getDb(),
): Promise<StoredItem> {
  const [item] = await updateStoredItems({ ...input, ids: [input.id] }, db);
  if (!item) {
    throw new Error(input.notFoundMessage ?? "Stored item not found.");
  }
  return item;
}

/** Deletes without checking existence first; callers assert when they need to. */
export async function deleteStoredItems(
  input: {
    ownerEmail: string;
    ids: string[];
    promotedToTask: boolean;
  },
  db: DbHandle = getDb(),
): Promise<void> {
  const ids = [...new Set(input.ids)];
  if (ids.length === 0) return;

  await db
    .delete(tasks)
    .where(
      and(
        eq(tasks.ownerEmail, input.ownerEmail),
        eq(tasks.promotedToTask, input.promotedToTask),
        inArray(tasks.id, ids),
      ),
    );
}

export async function deleteStoredItem(
  input: {
    ownerEmail: string;
    id: string;
    promotedToTask: boolean;
  },
  db: DbHandle = getDb(),
): Promise<void> {
  await deleteStoredItems({ ...input, ids: [input.id] }, db);
}

export async function assertStoredItemsExist(
  input: {
    ownerEmail: string;
    ids: string[];
    promotedToTask: boolean;
    notFoundMessage?: string;
  },
  db: DbHandle = getDb(),
): Promise<void> {
  const ids = [...new Set(input.ids)];
  if (ids.length === 0) return;

  const found = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.ownerEmail, input.ownerEmail),
        eq(tasks.promotedToTask, input.promotedToTask),
        inArray(tasks.id, ids),
      ),
    );

  if (found.length !== ids.length) {
    throw new Error(input.notFoundMessage ?? "Stored item not found.");
  }
}

export async function reorderStoredItems(
  input: {
    ownerEmail: string;
    promotedToTask: boolean;
    orderedIds: string[];
    includeDone?: boolean;
    idLabel?: string;
  },
  db: DbHandle = getDb(),
): Promise<void> {
  const idLabel =
    input.idLabel ?? (input.promotedToTask ? "taskIds" : "inboxItemIds");
  const visibleItems = await listStoredItems(
    {
      ownerEmail: input.ownerEmail,
      promotedToTask: input.promotedToTask,
      includeDone: input.includeDone,
    },
    db,
  );
  const visibleIds = new Set(visibleItems.map((item) => item.id));
  validateVisibleReorder(input.orderedIds, visibleIds, idLabel);

  if (!input.promotedToTask) {
    await applySortOrderUpdates(input, db);
    return;
  }

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

  const itemsById = new Map(allPromotedItems.map((item) => [item.id, item]));
  const visibleQueue = [...input.orderedIds];
  const merged = allPromotedItems.map((item) => {
    if (!visibleIds.has(item.id)) return item;
    const nextId = visibleQueue.shift();
    if (!nextId) {
      throw new Error(
        `${idLabel} must include every visible item exactly once.`,
      );
    }
    const nextItem = itemsById.get(nextId);
    if (!nextItem) {
      throw new Error("Stored item not found.");
    }
    return nextItem;
  });

  const timestamp = new Date().toISOString();
  const entries = merged.map((item, index) => ({
    id: item.id,
    value: index * SORT_GAP,
  }));

  await db.transaction(async (tx) => {
    for (const group of chunk(entries)) {
      await tx
        .update(tasks)
        .set({ sortOrder: caseById(tasks.id, group), updatedAt: timestamp })
        .where(
          and(
            eq(tasks.ownerEmail, input.ownerEmail),
            eq(tasks.promotedToTask, true),
            inArray(
              tasks.id,
              group.map((entry) => entry.id),
            ),
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

async function applySortOrderUpdates(
  input: {
    ownerEmail: string;
    promotedToTask: boolean;
    orderedIds: string[];
  },
  db: DbHandle = getDb(),
): Promise<void> {
  const timestamp = new Date().toISOString();
  const entries = input.orderedIds.map((id, index) => ({
    id,
    value: index * SORT_GAP,
  }));

  await db.transaction(async (tx) => {
    for (const group of chunk(entries)) {
      await tx
        .update(tasks)
        .set({ sortOrder: caseById(tasks.id, group), updatedAt: timestamp })
        .where(
          and(
            eq(tasks.ownerEmail, input.ownerEmail),
            eq(tasks.promotedToTask, input.promotedToTask),
            inArray(
              tasks.id,
              group.map((entry) => entry.id),
            ),
          ),
        );
    }
  });
}

/** Set `promotedToTask` from false → true on existing stored items (same ids). */
export async function promoteStoredItemsToTasks(
  input: {
    ownerEmail: string;
    ids: string[];
    now?: string;
  },
  db: DbHandle = getDb(),
): Promise<StoredItem[]> {
  const ids = [...new Set(input.ids)];
  if (ids.length === 0) {
    throw new Error("Provide at least one inbox item id.");
  }

  await assertStoredItemsExist(
    {
      ownerEmail: input.ownerEmail,
      ids,
      promotedToTask: false,
      notFoundMessage: "Stored item not found.",
    },
    db,
  );

  const timestamp = input.now ?? new Date().toISOString();
  const topSortOrder = await nextSortOrderForNewItem(
    input.ownerEmail,
    true,
    db,
  );
  const entries = ids.map((id, index) => ({
    id,
    value: topSortOrder - index * SORT_GAP,
  }));

  await db.transaction(async (tx) => {
    for (const group of chunk(entries)) {
      await tx
        .update(tasks)
        .set({
          promotedToTask: true,
          done: false,
          sortOrder: caseById(tasks.id, group),
          updatedAt: timestamp,
        })
        .where(
          and(
            eq(tasks.ownerEmail, input.ownerEmail),
            eq(tasks.promotedToTask, false),
            inArray(
              tasks.id,
              group.map((entry) => entry.id),
            ),
          ),
        );
    }
  });

  return listStoredItems(
    {
      ownerEmail: input.ownerEmail,
      ids,
      promotedToTask: true,
    },
    db,
  );
}

export async function promoteStoredItemToTask(
  input: {
    ownerEmail: string;
    id: string;
    now?: string;
  },
  db: DbHandle = getDb(),
): Promise<StoredItem> {
  const [item] = await promoteStoredItemsToTasks(
    { ownerEmail: input.ownerEmail, ids: [input.id], now: input.now },
    db,
  );
  if (!item) {
    throw new Error("Stored item not found.");
  }
  return item;
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
  db: DbHandle = getDb(),
): Promise<number> {
  const minSort = await minSortOrderForOwner(ownerEmail, promotedToTask, db);
  if (minSort == null) return 0;
  return minSort - SORT_GAP;
}

async function minSortOrderForOwner(
  ownerEmail: string,
  promotedToTask: boolean,
  db: DbHandle = getDb(),
): Promise<number | null> {
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
