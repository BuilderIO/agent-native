import type { PlanBlock } from "./plan-content";

const CONFLICT = Symbol("plan-merge-conflict");
type Merged = unknown | typeof CONFLICT;

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, nested) =>
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? Object.fromEntries(
          Object.entries(nested as Record<string, unknown>)
            .filter(([, entry]) => entry !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : nested,
  );
}

function same(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasUniqueIds(items: unknown[]): boolean {
  const ids = new Set<string>();
  for (const item of items) {
    const id = isRecord(item) ? item.id : undefined;
    if (typeof id !== "string" || ids.has(id)) return false;
    ids.add(id);
  }
  return true;
}

function idOf(item: unknown): string {
  return (item as { id: string }).id;
}

function sameSequence(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function isRichText(...items: unknown[]): boolean {
  return items.every((item) => isRecord(item) && item.type === "rich-text");
}

function mergeRichText(base: unknown, local: unknown, remote: unknown): Merged {
  const baseMarkdown = markdownOf(base);
  const localMarkdown = markdownOf(local);
  const remoteMarkdown = markdownOf(remote);
  const localChanged = !same(baseMarkdown, localMarkdown);
  const remoteChanged = !same(baseMarkdown, remoteMarkdown);
  if (localChanged && remoteChanged && !same(localMarkdown, remoteMarkdown)) {
    return CONFLICT;
  }
  // Prefer the saved block when local prose is unchanged; it retains fields
  // such as `editable` that the editor intentionally omits.
  return localChanged ? local : remote;
}

function markdownOf(block: unknown): unknown {
  return (block as { data?: { markdown?: unknown } }).data?.markdown;
}

function mergeKeyedArray(
  base: unknown[],
  local: unknown[],
  remote: unknown[],
): Merged {
  const baseIds = base.map(idOf);
  const localIds = local.map(idOf);
  const remoteIds = remote.map(idOf);
  const baseItems = new Map(base.map((item) => [idOf(item), item]));
  const localItems = new Map(local.map((item) => [idOf(item), item]));
  const remoteItems = new Map(remote.map((item) => [idOf(item), item]));

  const common = (ids: string[], other: Map<string, unknown>) =>
    ids.filter((id) => other.has(id));
  const localReordered = !sameSequence(
    common(baseIds, localItems),
    common(localIds, baseItems),
  );
  const remoteReordered = !sameSequence(
    common(baseIds, remoteItems),
    common(remoteIds, baseItems),
  );
  if (localReordered && remoteReordered) return CONFLICT;

  const resolved = new Map<string, unknown>();
  for (const id of new Set([...baseIds, ...localIds, ...remoteIds])) {
    const b = baseItems.get(id);
    const l = localItems.get(id);
    const r = remoteItems.get(id);
    if (b !== undefined) {
      if (l !== undefined && r !== undefined) {
        const item = isRichText(b, l, r)
          ? mergeRichText(b, l, r)
          : mergeValue(b, l, r);
        if (item === CONFLICT) return CONFLICT;
        resolved.set(id, item);
      } else {
        // Deleted on one side: only safe when the other side left it alone.
        const survivor = l ?? r;
        if (survivor !== undefined && !same(survivor, b)) return CONFLICT;
      }
    } else if (l !== undefined && r !== undefined) {
      if (!same(l, r)) return CONFLICT;
      resolved.set(id, l);
    } else {
      resolved.set(id, l ?? r);
    }
  }

  // The side that reordered supplies the order; the other side's additions and
  // deletions are folded into it.
  const [primary, secondary] = localReordered
    ? [localIds, remoteIds]
    : [remoteIds, localIds];
  const order = primary.filter((id) => resolved.has(id));
  for (const [index, id] of secondary.entries()) {
    if (!resolved.has(id) || order.includes(id)) continue;
    let anchor = -1;
    for (let i = index - 1; i >= 0 && anchor < 0; i--) {
      anchor = order.indexOf(secondary[i]);
    }
    order.splice(anchor + 1, 0, id);
  }
  return order.map((id) => resolved.get(id));
}

function mergeValue(base: unknown, local: unknown, remote: unknown): Merged {
  if (same(local, remote)) return local;
  if (same(base, local)) return remote;
  if (same(base, remote)) return local;

  if (isRecord(base) && isRecord(local) && isRecord(remote)) {
    const out: Record<string, unknown> = {};
    for (const key of new Set([
      ...Object.keys(base),
      ...Object.keys(local),
      ...Object.keys(remote),
    ])) {
      const value = mergeValue(base[key], local[key], remote[key]);
      if (value === CONFLICT) return CONFLICT;
      if (value !== undefined) out[key] = value;
    }
    return out;
  }
  if (
    Array.isArray(base) &&
    Array.isArray(local) &&
    Array.isArray(remote) &&
    hasUniqueIds(base) &&
    hasUniqueIds(local) &&
    hasUniqueIds(remote)
  ) {
    return mergeKeyedArray(base, local, remote);
  }
  return CONFLICT;
}

/**
 * Three-way merge of a plan's blocks. `base` is the saved content this client's
 * edit started from, `local` the blocks it is trying to save, and `remote` the
 * content another writer saved first. Blocks, and the id-keyed lists nested in
 * them, merge by id. Prose blocks both sides changed to different values conflict.
 *
 * Returns `null` when the edits overlap (the same value, one side deleting what
 * the other edited, both sides reordering) so the caller surfaces a conflict.
 * This never picks a side.
 */
export function mergePlanBlocks(
  base: PlanBlock[],
  local: PlanBlock[],
  remote: PlanBlock[],
): PlanBlock[] | null {
  const merged = mergeValue(base, local, remote);
  return merged === CONFLICT ? null : (merged as PlanBlock[]);
}
