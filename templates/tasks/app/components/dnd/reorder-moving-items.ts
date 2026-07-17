import { arrayMove } from "@dnd-kit/sortable";

/**
 * Multi-item drag reorder for sortable lists.
 *
 * Single-item drag delegates to dnd-kit `arrayMove`.
 *
 * Multi-item drag (active id is in `movingIds` and size > 1):
 * 1. Split the visible list into `moving` (moving ids, in list order) and
 *    `withoutMoving` (everything else).
 * 2. Compute where to splice `moving` into `withoutMoving` from the drop target
 *    (`overId`) and drag direction (compare active vs over index).
 * 3. Drop on another moving row → no reorder (insert at current block start).
 * 4. Drag down onto a row below the block → insert after that row.
 * 5. Drag up onto a row above the block → insert before that row, except when
 *    the target is more than one row above the block (then insert after it so
 *    "drop below row X" lands under X). Drop on the top row with a large gap
 *    before the block → insert at list start (move block to top).
 *
 * The branching looks worse than it is because dnd-kit reports the hovered row,
 * not an explicit before/after slot; these rules mirror what users expect when
 * moving a contiguous block.
 */

function countItemsBeforeIndex<T extends { id: string }>(
  items: T[],
  endIndex: number,
  movingIds: Set<string>,
) {
  return items.slice(0, endIndex).filter((item) => !movingIds.has(item.id))
    .length;
}

function gapBeforeBlock<T extends { id: string }>(
  items: T[],
  overIndex: number,
  firstMovingIndex: number,
  movingIds: Set<string>,
) {
  return items
    .slice(overIndex + 1, firstMovingIndex)
    .filter((item) => !movingIds.has(item.id)).length;
}

function findLastMovingIndex<T extends { id: string }>(
  items: T[],
  movingIds: Set<string>,
) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (movingIds.has(items[index]!.id)) return index;
  }
  return -1;
}

function computeBlockInsertIndex<T extends { id: string }>(
  items: T[],
  activeId: string,
  overId: string,
  movingIds: Set<string>,
  withoutMoving: T[],
) {
  const activeIndex = items.findIndex((item) => item.id === activeId);
  const overIndex = items.findIndex((item) => item.id === overId);
  if (overIndex < 0 || activeIndex < 0) {
    return null;
  }

  const firstMovingIndex = items.findIndex((item) => movingIds.has(item.id));
  const lastMovingIndex = findLastMovingIndex(items, movingIds);
  const draggingDown = activeIndex < overIndex;
  const draggingUp = activeIndex > overIndex;

  if (movingIds.has(overId)) {
    return countItemsBeforeIndex(items, firstMovingIndex, movingIds);
  }

  const overInWithout = withoutMoving.findIndex((item) => item.id === overId);
  if (overInWithout < 0) {
    return countItemsBeforeIndex(items, overIndex, movingIds);
  }

  if (draggingDown && overIndex > lastMovingIndex) {
    return overInWithout + 1;
  }

  if (draggingUp && overIndex < firstMovingIndex) {
    if (overIndex === 0) {
      const gap = gapBeforeBlock(items, overIndex, firstMovingIndex, movingIds);
      if (gap === 1) {
        return overInWithout + 1;
      }
      return 0;
    }

    if (overIndex < firstMovingIndex - 1) {
      return overInWithout + 1;
    }

    return overInWithout;
  }

  return countItemsBeforeIndex(items, overIndex, movingIds);
}

/** Reorder a list, moving one item or a contiguous block identified by `movingIds`. */
export function reorderMovingItems<T extends { id: string }>(
  items: T[],
  activeId: string,
  overId: string,
  movingIds: Set<string>,
) {
  const isBlockDrag = movingIds.has(activeId) && movingIds.size > 1;
  if (!isBlockDrag) {
    const oldIndex = items.findIndex((item) => item.id === activeId);
    const newIndex = items.findIndex((item) => item.id === overId);
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) {
      return items;
    }
    return arrayMove(items, oldIndex, newIndex);
  }

  const moving = items.filter((item) => movingIds.has(item.id));
  const withoutMoving = items.filter((item) => !movingIds.has(item.id));
  const insertIndex = computeBlockInsertIndex(
    items,
    activeId,
    overId,
    movingIds,
    withoutMoving,
  );
  if (insertIndex === null) {
    return items;
  }

  const next = [...withoutMoving];
  next.splice(insertIndex, 0, ...moving);
  return next;
}

export function isBlockDragActive(
  activeId: string | null,
  movingIds: Set<string>,
) {
  return Boolean(activeId && movingIds.has(activeId) && movingIds.size > 1);
}

/** Overlay content item: topmost moving row during block drag, else the grabbed row. */
export function getDragOverlayItem<T extends { id: string }>(
  items: T[],
  activeId: string | null,
  movingIds: Set<string>,
) {
  if (!activeId) return null;

  if (isBlockDragActive(activeId, movingIds)) {
    return items.find((item) => movingIds.has(item.id)) ?? null;
  }

  return items.find((item) => item.id === activeId) ?? null;
}
