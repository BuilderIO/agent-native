/**
 * Saves that check what they read: the half a browser can import. A write sends
 * back the revision it read; a stale one fails with one typed conflict carrying
 * the current value, and {@link saveWithMerge} merges onto it and saves again.
 * The server half is `@agent-native/core/save-conflict/server`.
 */

export const SAVE_CONFLICT_ERROR_CODE = "save_conflict";

const MAX_CONFLICT_MERGES = 3;

export interface SaveConflictDetails<T = unknown> {
  current: T;
  /** `null` when the record doesn't exist. */
  currentRevision: string | null;
}

export interface SavedRecord<T> {
  value: T;
  /** `null` when the record doesn't exist yet, so the first save creates it. */
  revision: string | null;
}

/**
 * True for the conflict `saveConflict()` throws, however it reached this side:
 * the action route, `useAction`, or an app's own fetch that kept `errorCode` and
 * `details`.
 */
export function isSaveConflict(error: unknown): error is Error & {
  errorCode: typeof SAVE_CONFLICT_ERROR_CODE;
  details: SaveConflictDetails;
} {
  if (!error || typeof error !== "object") return false;
  const { errorCode, details } = error as {
    errorCode?: unknown;
    details?: unknown;
  };
  return (
    errorCode === SAVE_CONFLICT_ERROR_CODE &&
    !!details &&
    typeof details === "object" &&
    "current" in details &&
    "currentRevision" in details
  );
}

function canonicalJson(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, nested) =>
    isRecord(nested)
      ? Object.fromEntries(
          Object.entries(nested)
            .filter(([, entry]) => entry !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : nested,
  );
}

/** Whether two saved values are the same, ignoring key order. */
export function isSameRecord(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * A token for a stored value, the same in a browser and on a server. Any writer
 * that changes the value changes the token, including one that knows nothing
 * about revisions, and tables need no new column. It detects change, not
 * tampering: anyone who can send it can already write the record.
 */
export function saveRevisionOf(value: unknown): string {
  const text = canonicalJson(value) ?? "";
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return `rev_${text.length.toString(36)}_${hash.toString(36)}`;
}

type Side = "mine" | "theirs";

interface MergeRun {
  /** The side that wins where both writers changed the same value. */
  prefer: Side;
  overlaps: string[];
}

function fieldPath(path: string[]): string {
  return path.join(".") || "value";
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

function mergeKeyedArray(
  base: unknown[],
  mine: unknown[],
  theirs: unknown[],
  path: string[],
  run: MergeRun,
): unknown[] {
  const baseIds = base.map(idOf);
  const mineIds = mine.map(idOf);
  const theirIds = theirs.map(idOf);
  const baseItems = new Map(base.map((item) => [idOf(item), item]));
  const mineItems = new Map(mine.map((item) => [idOf(item), item]));
  const theirItems = new Map(theirs.map((item) => [idOf(item), item]));

  const common = (ids: string[], other: Map<string, unknown>) =>
    ids.filter((id) => other.has(id));
  const mineReordered = !sameSequence(
    common(baseIds, mineItems),
    common(mineIds, baseItems),
  );
  const theirsReordered = !sameSequence(
    common(baseIds, theirItems),
    common(theirIds, baseItems),
  );
  if (
    mineReordered &&
    theirsReordered &&
    !sameSequence(common(mineIds, theirItems), common(theirIds, mineItems))
  ) {
    run.overlaps.push(fieldPath([...path, "order"]));
  }

  const resolved = new Map<string, unknown>();
  for (const id of new Set([...baseIds, ...mineIds, ...theirIds])) {
    const b = baseItems.get(id);
    const m = mineItems.get(id);
    const t = theirItems.get(id);
    if (m !== undefined && t !== undefined) {
      resolved.set(id, mergeValue(b, m, t, [...path, id], run));
    } else if (b === undefined) {
      resolved.set(id, m ?? t);
    } else {
      // Deleted on one side: only clean when the other side left it alone.
      const survivor = m ?? t;
      if (survivor === undefined || isSameRecord(survivor, b)) continue;
      run.overlaps.push(fieldPath([...path, id]));
      const survivorSide: Side = m !== undefined ? "mine" : "theirs";
      if (run.prefer === survivorSide) resolved.set(id, survivor);
    }
  }

  // The side that reordered supplies the order; the other side's additions and
  // deletions are folded into it.
  const mineLeads =
    mineReordered && theirsReordered ? run.prefer === "mine" : mineReordered;
  const [primary, secondary] = mineLeads
    ? [mineIds, theirIds]
    : [theirIds, mineIds];
  const order = primary.filter((id) => resolved.has(id));
  for (const [index, id] of secondary.entries()) {
    if (!resolved.has(id) || order.includes(id)) continue;
    let anchor = -1;
    for (let i = index - 1; i >= 0 && anchor < 0; i -= 1) {
      anchor = order.indexOf(secondary[i]);
    }
    order.splice(anchor + 1, 0, id);
  }
  return order.map((id) => resolved.get(id));
}

function mergeValue(
  base: unknown,
  mine: unknown,
  theirs: unknown,
  path: string[],
  run: MergeRun,
): unknown {
  if (isSameRecord(mine, theirs)) return mine;
  if (isSameRecord(base, mine)) return theirs;
  if (isSameRecord(base, theirs)) return mine;

  if (isRecord(base) && isRecord(mine) && isRecord(theirs)) {
    const out: Record<string, unknown> = {};
    for (const key of new Set([
      ...Object.keys(base),
      ...Object.keys(mine),
      ...Object.keys(theirs),
    ])) {
      const value = mergeValue(
        base[key],
        mine[key],
        theirs[key],
        [...path, key],
        run,
      );
      if (value !== undefined) out[key] = value;
    }
    return out;
  }
  if (
    Array.isArray(base) &&
    Array.isArray(mine) &&
    Array.isArray(theirs) &&
    hasUniqueIds(base) &&
    hasUniqueIds(mine) &&
    hasUniqueIds(theirs)
  ) {
    return mergeKeyedArray(base, mine, theirs, path, run);
  }
  run.overlaps.push(fieldPath(path));
  return run.prefer === "mine" ? mine : theirs;
}

export type RecordMerge<T> =
  | { ok: true; merged: T }
  | {
      ok: false;
      /** Paths both writers changed, such as `subject` or `fields.f1.label`. */
      fields: string[];
      /** Everything that merged cleanly, with my value where they overlap. */
      keepMine: T;
      /** Everything that merged cleanly, with their value where they overlap. */
      useTheirs: T;
    };

/**
 * Three-way merge of a record, field by field: `base` is what my edit started
 * from, `mine` is what I'm saving, `theirs` is what another writer saved first.
 * Lists of objects with unique string ids merge by id. It never picks a side on
 * its own: overlaps are reported with both ways of settling them.
 */
export function mergeRecords<T>(base: T, mine: T, theirs: T): RecordMerge<T> {
  const fields: string[] = [];
  const keepMine = mergeValue(base, mine, theirs, [], {
    prefer: "mine",
    overlaps: fields,
  }) as T;
  if (fields.length === 0) return { ok: true, merged: keepMine };
  const useTheirs = mergeValue(base, mine, theirs, [], {
    prefer: "theirs",
    overlaps: [],
  }) as T;
  return { ok: false, fields, keepMine, useTheirs };
}

/**
 * The local copy after a save: `sent` is what the save was given, `local` is the
 * copy now, which may hold edits made while it ran, and `saved` is what came
 * back. What other writers changed comes in, and newer local edits stay.
 */
export function rebaseOntoSaved<T>(sent: T, local: T, saved: T): T {
  const merge = mergeRecords(sent, local, saved);
  return merge.ok ? merge.merged : merge.keepMine;
}

export interface SaveOverlap<T> {
  fields: string[];
  base: T;
  mine: T;
  theirs: T;
  keepMine: T;
  useTheirs: T;
}

/** Both writers changed the same field and nobody was there to choose. */
export class SaveOverlapError<T = unknown> extends Error {
  constructor(readonly overlap: SaveOverlap<T>) {
    super(
      `Another writer changed the same fields: ${overlap.fields.join(", ")}`,
    );
    this.name = "SaveOverlapError";
  }
}

export interface SaveWithMergeOptions<T> {
  /** The saved version this edit started from. */
  base: SavedRecord<T>;
  mine: T;
  /** One save attempt. It should throw the typed conflict when it's stale. */
  save: (attempt: {
    value: T;
    revision: string | null;
    base: T;
  }) => Promise<SavedRecord<T>>;
  /** Puts `details.current` into the form `base` and `mine` are in. */
  parseCurrent?: (current: unknown) => T;
  merge?: (base: T, mine: T, theirs: T) => RecordMerge<T>;
  /**
   * Asks the person which version to keep and returns the value to save.
   * Without it an overlap throws {@link SaveOverlapError}.
   */
  resolveOverlap?: (overlap: SaveOverlap<T>) => Promise<T>;
}

/**
 * Saves a record, merging onto whatever another writer saved first. Saves of one
 * record should run one at a time: the caller holds the base between them.
 */
export async function saveWithMerge<T>({
  base,
  mine,
  save,
  parseCurrent,
  merge = mergeRecords,
  resolveOverlap,
}: SaveWithMergeOptions<T>): Promise<SavedRecord<T>> {
  let attempt = { base, mine };
  for (let merges = 0; ; merges += 1) {
    try {
      return await save({
        value: attempt.mine,
        revision: attempt.base.revision,
        base: attempt.base.value,
      });
    } catch (error) {
      if (!isSaveConflict(error) || merges >= MAX_CONFLICT_MERGES) throw error;
      const { current, currentRevision } = error.details;
      const theirs = parseCurrent ? parseCurrent(current) : (current as T);
      const result = merge(attempt.base.value, attempt.mine, theirs);
      let next: T;
      if (result.ok) {
        next = result.merged;
      } else {
        const overlap: SaveOverlap<T> = {
          fields: result.fields,
          base: attempt.base.value,
          mine: attempt.mine,
          theirs,
          keepMine: result.keepMine,
          useTheirs: result.useTheirs,
        };
        if (!resolveOverlap) throw new SaveOverlapError(overlap);
        next = await resolveOverlap(overlap);
      }
      // Nothing of mine is left to add, so a save would only rewrite their copy.
      if (isSameRecord(next, theirs)) {
        return { value: theirs, revision: currentRevision };
      }
      attempt = {
        base: { value: theirs, revision: currentRevision },
        mine: next,
      };
    }
  }
}
