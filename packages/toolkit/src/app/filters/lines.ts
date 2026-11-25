import {
  createFilterGroup,
  filterItemId,
  type FilterGroup,
  type FilterItem,
  type FilterMode,
  type FilterRule,
  type FilterState,
} from "./model.js";

/** Groups sit one inside another this many deep at most, as in Content's saved views. */
export const FILTER_GROUP_LEVELS = 2;

export interface FilterLineOptions {
  /** How deep groups may nest: 2 with nested groups, else 1. */
  levels?: number | undefined;
}

export interface FilterJoinResult {
  state: FilterState;
  /**
   * The change gave the line's whole group the new word instead of splitting
   * or boxing part of it, because a box there would nest too deep.
   */
  whole: boolean;
}

const TOP = "";

const flip = (mode: FilterMode): FilterMode => (mode === "and" ? "or" : "and");

function asGroup(state: FilterState): FilterGroup {
  return { kind: "group", id: TOP, mode: state.mode, rules: state.items };
}

function fromGroup(state: FilterState, top: FilterGroup): FilterState {
  return { ...state, mode: top.mode, items: top.rules };
}

function depth(item: FilterItem): number {
  if (item.kind === "rule") return 0;
  return 1 + Math.max(0, ...item.rules.map(depth));
}

function sameIn(mode: FilterMode, items: readonly FilterItem[]): FilterItem[] {
  return items.flatMap((item) =>
    item.kind === "group" && item.mode === mode ? item.rules : [item],
  );
}

function findItem(group: FilterGroup, id: string): FilterItem | undefined {
  for (const item of group.rules) {
    if (item.id === id) return item;
    if (item.kind === "group") {
      const found = findItem(item, id);
      if (found) return found;
    }
  }
  return undefined;
}

function parentOf(group: FilterGroup, id: string): FilterGroup | undefined {
  if (group.rules.some((item) => item.id === id)) return group;
  for (const item of group.rules) {
    if (item.kind !== "group") continue;
    const found = parentOf(item, id);
    if (found) return found;
  }
  return undefined;
}

function swap(
  group: FilterGroup,
  id: string,
  replace: (item: FilterItem, parent: FilterGroup) => FilterItem[],
): FilterGroup {
  return {
    ...group,
    rules: group.rules.flatMap((item) => {
      if (item.id === id) return replace(item, group);
      return item.kind === "group" ? [swap(item, id, replace)] : [item];
    }),
  };
}

function patchGroup(
  top: FilterGroup,
  id: string,
  patch: (group: FilterGroup) => FilterGroup,
): FilterGroup {
  if (top.id === id) return patch(top);
  return swap(top, id, (item) => [item.kind === "group" ? patch(item) : item]);
}

function setWhole(top: FilterGroup, groupId: string, mode: FilterMode) {
  if (top.id === groupId)
    return { ...top, mode, rules: sameIn(mode, top.rules) };
  return swap(top, groupId, (item, parent) => {
    if (item.kind === "rule") return [item];
    const rules = sameIn(mode, item.rules);
    return parent.mode === mode ? rules : [{ ...item, mode, rules }];
  });
}

/** The word before an item: its parent's mode. Undefined for a first line. */
export function filterLineJoin(
  state: FilterState,
  id: string,
): FilterMode | undefined {
  const parent = parentOf(asGroup(state), id);
  if (!parent || parent.rules[0]?.id === id) return undefined;
  return parent.mode;
}

/** The group an item sits in, or undefined at the top level. */
export function filterLineParent(
  state: FilterState,
  id: string,
): FilterGroup | undefined {
  const parent = parentOf(asGroup(state), id);
  return parent && parent.id !== TOP ? parent : undefined;
}

/**
 * Sets the word before the line `id`, with "and" binding before "or".
 * Changing an "and" to "or" splits the run of "and"s there into two groups,
 * so the lines before and after it keep their words. Changing an "or" to
 * "and" groups the two lines it joins. A group of two takes the word whole.
 * Where a split or a box would nest deeper than `levels`, the whole group
 * takes the word, and `whole` says so.
 */
export function joinFilterLine(
  state: FilterState,
  id: string,
  mode: FilterMode,
  { levels = FILTER_GROUP_LEVELS }: FilterLineOptions = {},
): FilterJoinResult {
  const top = asGroup(state);
  const parent = parentOf(top, id);
  const at = parent ? parent.rules.findIndex((item) => item.id === id) : -1;
  if (!parent || at < 1 || parent.mode === mode) return { state, whole: false };
  const whole = fromGroup(state, setWhole(top, parent.id, mode));
  if (parent.rules.length === 2) return { state: whole, whole: false };
  let next: FilterGroup;
  if (mode === "or") {
    const outer = parent.id === TOP ? undefined : parentOf(top, parent.id);
    const lifted = outer?.mode === "or";
    const part = (items: FilterItem[], id?: string): FilterItem[] =>
      items.length > 1
        ? [
            {
              kind: "group",
              id: id ?? filterItemId("g"),
              mode: "and",
              rules: items,
            },
          ]
        : sameIn("or", items);
    const parts = [
      ...part(parent.rules.slice(0, at), lifted ? parent.id : undefined),
      ...part(parent.rules.slice(at)),
    ];
    next =
      parent.id === TOP
        ? { ...top, mode: "or", rules: parts }
        : swap(top, parent.id, () =>
            lifted ? parts : [{ ...parent, mode: "or", rules: parts }],
          );
  } else {
    const pair = parent.rules.slice(at - 1, at + 1);
    const kept = pair.find(
      (item) => item.kind === "group" && item.mode === "and",
    );
    const rules = [...parent.rules];
    rules.splice(at - 1, 2, {
      kind: "group",
      id: kept?.id ?? filterItemId("g"),
      mode: "and",
      rules: sameIn("and", pair),
    });
    next = patchGroup(top, parent.id, (group) => ({ ...group, rules }));
  }
  if (depth(next) <= levels + 1)
    return { state: fromGroup(state, next), whole: false };
  return { state: whole, whole: true };
}

/** Whether `joinFilterLine` would give the line's whole group the word. */
export function filterJoinIsWhole(
  state: FilterState,
  id: string,
  mode: FilterMode,
  options?: FilterLineOptions,
): boolean {
  return joinFilterLine(state, id, mode, options).whole;
}

/** Gives a group's lines to its parent, in its place. */
export function ungroupFilterLine(
  state: FilterState,
  groupId: string,
): FilterState {
  const top = swap(asGroup(state), groupId, (item, parent) =>
    item.kind === "group" ? sameIn(parent.mode, item.rules) : [item],
  );
  return fromGroup(state, top);
}

export interface FilterLinePlace {
  /** The group to put the line in; undefined for the top level. */
  groupId?: string | undefined;
  /** Its index there, counted once the line has left its old place. */
  index: number;
}

/**
 * Moves a line or group to `place`. A group left with one line becomes that
 * line, and a group put in a group with its word joins it. Returns `state`
 * itself when the move would nest deeper than `levels` or into itself.
 */
export function moveFilterLine(
  state: FilterState,
  id: string,
  place: FilterLinePlace,
  { levels = FILTER_GROUP_LEVELS }: FilterLineOptions = {},
): FilterState {
  const top = asGroup(state);
  const item = findItem(top, id);
  const from = parentOf(top, id);
  const toId = place.groupId ?? TOP;
  if (!item || !from) return state;
  if (item.kind === "group" && (item.id === toId || findItem(item, toId))) {
    return state;
  }
  const removed = swap(top, id, () => []);
  let next = patchGroup(removed, toId, (group) => {
    const index = Math.max(0, Math.min(place.index, group.rules.length));
    return {
      ...group,
      rules: [
        ...group.rules.slice(0, index),
        item,
        ...group.rules.slice(index),
      ],
    };
  });
  if (item.kind === "group") {
    next = swap(next, id, (moved, parent) =>
      moved.kind === "group" && parent.mode === moved.mode
        ? moved.rules
        : [moved],
    );
  }
  if (from.id !== TOP && from.id !== toId) {
    next = swap(next, from.id, (left, parent) => {
      if (left.kind === "rule") return [left];
      if (left.rules.length === 0) return [];
      return left.rules.length > 1 ? [left] : sameIn(parent.mode, left.rules);
    });
  }
  if (depth(next) > levels + 1) return state;
  return fromGroup(state, next);
}

/** Moves a line out of its group, to just after the group. */
export function takeFilterLineOut(
  state: FilterState,
  id: string,
  options?: FilterLineOptions,
): FilterState {
  const top = asGroup(state);
  const parent = parentOf(top, id);
  if (!parent || parent.id === TOP) return state;
  const outer = parentOf(top, parent.id);
  if (!outer) return state;
  const index = outer.rules.findIndex((item) => item.id === parent.id) + 1;
  return moveFilterLine(
    state,
    id,
    { groupId: outer.id === TOP ? undefined : outer.id, index },
    options,
  );
}

/**
 * Puts `rule` beside the line `id` in a new group of their own, with the
 * other word from the line's parent. Returns `state` itself where the group
 * would nest too deep.
 */
export function groupFilterLineWith(
  state: FilterState,
  id: string,
  rule: FilterRule,
  { levels = FILTER_GROUP_LEVELS }: FilterLineOptions = {},
): FilterState {
  const top = asGroup(state);
  if (!findItem(top, id)) return state;
  const next = swap(top, id, (item, parent) => [
    { ...createFilterGroup([item, rule], flip(parent.mode)) },
  ]);
  if (depth(next) > levels + 1) return state;
  return fromGroup(state, next);
}

function copyItem(item: FilterItem): FilterItem {
  if (item.kind === "rule")
    return { ...item, id: filterItemId("r"), value: [...item.value] };
  return { ...item, id: filterItemId("g"), rules: item.rules.map(copyItem) };
}

/** Puts a copy of a line or group just after it, and returns the copy's id. */
export function duplicateFilterLine(
  state: FilterState,
  id: string,
): { state: FilterState; id: string | undefined } {
  let copyId: string | undefined;
  const top = swap(asGroup(state), id, (item) => {
    const copy = copyItem(item);
    copyId = copy.id;
    return [item, copy];
  });
  return { state: copyId ? fromGroup(state, top) : state, id: copyId };
}

/** How deep the group `groupId` sits: 1 at the top level. 0 for the top. */
export function filterGroupLevel(state: FilterState, groupId: string): number {
  const walk = (group: FilterGroup, level: number): number => {
    if (group.id === groupId) return level;
    for (const item of group.rules) {
      if (item.kind !== "group") continue;
      const found = walk(item, level + 1);
      if (found >= 0) return found;
    }
    return -1;
  };
  return walk(asGroup(state), 0);
}
