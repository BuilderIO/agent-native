import { indexedItem, requireItem } from "./indexed-item.js";

/** Sibling order follows array order. Parent references keep subtrees intact during moves. */
export interface LayerRecord {
  id: string;
  parentId: string | null;
  name: string;
  container?: boolean;
  hidden?: boolean;
  locked?: boolean;
  /** A document root can accept children while remaining fixed in place. */
  fixed?: boolean;
}

export type LayerPlacement = "before" | "inside" | "after";
export interface LayerMove {
  ids: readonly string[];
  targetId: string;
  placement: LayerPlacement;
}

function walkLayers<T extends LayerRecord>(
  roots: readonly T[],
  childrenOf: (item: T) => readonly T[] | undefined,
  visit: (item: T, depth: number, position: number, count: number) => void,
) {
  const stack = [{ siblings: roots, cursor: 0 }];
  while (stack.length) {
    const group = requireItem(stack, stack.length - 1);
    if (group.cursor === group.siblings.length) {
      stack.pop();
      continue;
    }
    const item = requireItem(group.siblings, group.cursor++);
    visit(item, stack.length - 1, group.cursor, group.siblings.length);
    const children = childrenOf(item);
    if (children?.length) stack.push({ siblings: children, cursor: 0 });
  }
}

export function indexLayers<T extends LayerRecord>(items: readonly T[]) {
  const byId = new Map<string, T>();
  const children = new Map<string | null, T[]>();
  for (const item of items) {
    if (byId.has(item.id)) throw new Error("Duplicate layer id: " + item.id);
    byId.set(item.id, item);
    const siblings = children.get(item.parentId);
    if (siblings) siblings.push(item);
    else children.set(item.parentId, [item]);
  }
  for (const item of items) {
    if (item.parentId !== null && !byId.get(item.parentId)?.container)
      throw new Error("Invalid parent for layer: " + item.id);
  }
  const order: T[] = [];
  type Location = {
    locked: boolean;
    sibling: number;
    start: number;
    end: number;
    parentLocked: boolean;
  };
  const locations = new Map<T, Location>();
  const ancestors: Location[] = [];
  function finishSubtrees(depth: number) {
    while (ancestors.length > depth) {
      requireItem(ancestors, ancestors.length - 1).end = order.length;
      ancestors.pop();
    }
  }
  walkLayers(
    children.get(null) ?? [],
    (item) => children.get(item.id),
    (item, depth, position) => {
      finishSubtrees(depth);
      const parent = indexedItem(ancestors, depth - 1);
      const parentLocked = parent?.locked === true;
      const location = {
        sibling: position - 1,
        start: order.length,
        end: order.length + 1,
        parentLocked,
        locked: parentLocked || item.locked === true,
      };
      locations.set(item, location);
      ancestors.push(location);
      order.push(item);
    },
  );
  finishSubtrees(0);
  if (order.length !== items.length)
    throw new Error("Layer hierarchy contains a cycle.");
  function location(item: T) {
    const position = locations.get(item);
    if (position === undefined)
      throw new Error("Missing location for layer: " + item.id);
    return position;
  }
  return {
    byId,
    children,
    order,
    hasLockedAncestor: (item: T) => location(item).parentLocked,
    isAncestor: (ancestor: T, item: T) => {
      const range = location(ancestor);
      const position = location(item).start;
      return range.start < position && position < range.end;
    },
    siblingIndex: (item: T) => location(item).sibling,
  };
}

type Index<T extends LayerRecord> = ReturnType<typeof indexLayers<T>>;

export function ancestorMatches<T extends LayerRecord>(
  item: T,
  index: Index<T>,
  matches: (item: T) => boolean,
  cache?: Map<string, boolean>,
) {
  let parent = item.parentId;
  const visited: string[] | undefined = cache ? [] : undefined;
  let matched = false;
  while (parent !== null) {
    const known = cache?.get(parent);
    if (known !== undefined) {
      matched = known;
      break;
    }
    const ancestor = index.byId.get(parent);
    if (!ancestor) throw new Error("Missing ancestor: " + parent);
    visited?.push(parent);
    if (matches(ancestor)) {
      matched = true;
      break;
    }
    parent = ancestor.parentId;
  }
  if (visited && cache) {
    for (const id of visited) cache.set(id, matched);
  }
  return matched;
}

/** A single subtree is a contiguous range in document order. */
export function selectedAncestorLookup<T extends LayerRecord>(
  index: Index<T>,
  selected: ReadonlySet<string>,
): (item: T) => boolean {
  if (selected.size === 1) {
    const first = selected.values().next();
    const ancestor = first.done ? undefined : index.byId.get(first.value);
    return (item) => ancestor !== undefined && index.isAncestor(ancestor, item);
  }
  const cache = new Map<string, boolean>();
  const matches = (parent: T) => selected.has(parent.id);
  return (item) => ancestorMatches(item, index, matches, cache);
}

export function visibleLayers<T extends LayerRecord>(
  index: Index<T>,
  expanded: ReadonlySet<string>,
  selection: ReadonlySet<string>,
) {
  const rows: {
    item: T;
    depth: number;
    position: number;
    count: number;
    locked: boolean;
    parentLocked: boolean;
    selectedAncestor: boolean;
  }[] = [];
  const locks: boolean[] = [],
    selectedParents: boolean[] = [];
  walkLayers(
    index.children.get(null) ?? [],
    (item) => (expanded.has(item.id) ? index.children.get(item.id) : undefined),
    (item, depth, position, count) => {
      const parentLocked = locks[depth - 1] === true;
      const selectedAncestor = selectedParents[depth - 1] === true;
      const locked = parentLocked || item.locked === true;
      locks[depth] = locked;
      selectedParents[depth] = selectedAncestor || selection.has(item.id);
      rows.push({
        item,
        depth,
        position,
        count,
        locked,
        parentLocked,
        selectedAncestor,
      });
    },
  );
  return rows;
}

function movingRoots<T extends LayerRecord>(
  index: Index<T>,
  selected: ReadonlySet<string>,
  hasSelectedAncestor: (item: T) => boolean,
) {
  const moving = new Set<string>();
  let commonParent: string | null | undefined;
  let first = Infinity;
  let last = -1;
  for (const id of selected) {
    const item = index.byId.get(id);
    if (!item) return null;
    if (hasSelectedAncestor(item)) continue;
    if (item.fixed || item.locked || index.hasLockedAncestor(item)) return null;
    if (!moving.size) commonParent = item.parentId;
    else if (commonParent !== item.parentId) commonParent = undefined;
    const position = index.siblingIndex(item);
    first = Math.min(first, position);
    last = Math.max(last, position);
    moving.add(id);
  }
  return {
    moving,
    first,
    blockParent: last - first + 1 === moving.size ? commonParent : undefined,
  };
}

/** Find the sibling beyond a selected block for keyboard and menu moves. */
export function createSiblingMoveTarget<T extends LayerRecord>(
  index: Index<T>,
  selected: ReadonlySet<string>,
) {
  const runs = new Map<T, { first: number; last: number }>();
  return (item: T, step: -1 | 1) => {
    const siblings = index.children.get(item.parentId);
    if (!siblings) return undefined;
    const position = index.siblingIndex(item);
    const neighbor = indexedItem(siblings, position + step);
    if (!neighbor || !selected.has(item.id) || !selected.has(neighbor.id))
      return neighbor;
    let run = runs.get(item);
    if (!run) {
      let first = position;
      let last = position;
      while (first > 0 && selected.has(requireItem(siblings, first - 1).id))
        first--;
      while (
        last + 1 < siblings.length &&
        selected.has(requireItem(siblings, last + 1).id)
      )
        last++;
      run = { first, last };
      for (let i = first; i <= last; i++)
        runs.set(requireItem(siblings, i), run);
    }
    return indexedItem(siblings, step < 0 ? run.first - 1 : run.last + 1);
  };
}

/** Reuse the selected roots while testing drop targets against one document snapshot. */
export function createLayerMovePlanner<T extends LayerRecord>(
  index: Index<T>,
  ids: readonly string[] | ReadonlySet<string>,
) {
  const selected: ReadonlySet<string> = ids instanceof Set ? ids : new Set(ids);
  const hasSelectedAncestor = selectedAncestorLookup(index, selected);
  let roots: ReturnType<typeof movingRoots<T>> | undefined;
  return (targetId: string, placement: LayerPlacement) => {
    const target = index.byId.get(targetId);
    if (!target || !selected.size || selected.has(targetId)) return null;
    const inside = placement === "inside";
    if (inside && (!target.container || target.locked)) return null;
    if (!inside && target.fixed) return null;
    if (index.hasLockedAncestor(target) || hasSelectedAncestor(target))
      return null;
    if (roots === undefined)
      roots = movingRoots(index, selected, hasSelectedAncestor);
    if (!roots) return null;
    const { moving, first, blockParent } = roots;
    const parentId = inside ? target.id : target.parentId;
    const siblings = index.children.get(parentId) ?? [];
    const offset = inside
      ? siblings.length
      : index.siblingIndex(target) + Number(placement === "after");
    const start = placement === "after" ? offset : offset - moving.size;
    if (blockParent === parentId && first === start) return null;
    return { parentId, siblings, offset, moving };
  };
}

export function planLayerMove<T extends LayerRecord>(
  index: Index<T>,
  move: LayerMove,
) {
  return createLayerMovePlanner(index, move.ids)(move.targetId, move.placement);
}

export function resolveLayerMove<T extends LayerRecord>(
  index: Index<T>,
  move: LayerMove,
): T[] | null {
  const plan = planLayerMove(index, move);
  if (!plan) return null;
  const { parentId, siblings, offset, moving } = plan;
  const ordered: T[] = [];
  const sourceParents = new Set<string | null>();
  const single =
    move.ids.length === 1
      ? index.byId.get(requireItem(move.ids, 0))
      : undefined;
  const roots = single
    ? [single]
    : index.order.filter((item) => moving.has(item.id));
  for (let i = 0; i <= siblings.length; i++) {
    if (i === offset) {
      for (const item of roots) {
        sourceParents.add(item.parentId);
        ordered.push(item.parentId === parentId ? item : { ...item, parentId });
      }
    }
    const sibling = indexedItem(siblings, i);
    if (sibling && !moving.has(sibling.id)) ordered.push(sibling);
  }
  const next: T[] = [];
  function childrenOf(parent: string | null) {
    if (parent === parentId) return ordered;
    const children = index.children.get(parent);
    return sourceParents.has(parent)
      ? children?.filter((item) => !moving.has(item.id))
      : children;
  }
  walkLayers(
    childrenOf(null) ?? [],
    (item) => childrenOf(item.id),
    (item) => next.push(item),
  );
  return next;
}
