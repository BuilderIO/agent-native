import { ActionContractError } from "../action.js";
import { countOutcome } from "../tracking/failure-counters.js";
import { SAVE_CONFLICT_ERROR_CODE } from "./index.js";

export { saveRevisionOf, isSameRecord } from "./index.js";

/** For an action's `expectedRevision` argument, so agents read one instruction. */
export const EXPECTED_REVISION_DESCRIPTION =
  "The `revision` from your last read of this record, unchanged. If the record has changed since, the save fails with errorCode save_conflict and details.current and details.currentRevision: redo your edit on the current value and resend with that revision.";

const MAX_SAVE_ATTEMPTS = 3;

export type SaveOutcome = "written" | "already_applied" | "conflict";

/** `record` names what was saved in a few words, like `form_fields`. */
export function countSaveOutcome(record: string, outcome: SaveOutcome): void {
  countOutcome("save_outcome_counts", { record, outcome });
}

/**
 * The one typed conflict: a stale write, carrying what's there now so the caller
 * can merge without reading again.
 */
export function saveConflict<T>(
  record: string,
  current: T,
  currentRevision: string | null,
): ActionContractError {
  countSaveOutcome(record, "conflict");
  return new ActionContractError(
    `This ${record.replace(/_/g, " ")} changed after you read it, so the save was not applied. Redo your edit on details.current and resend with expectedRevision set to details.currentRevision. If details.current was left out, read the record again.`,
    {
      errorCode: SAVE_CONFLICT_ERROR_CODE,
      statusCode: 409,
      details: { current, currentRevision },
    },
  );
}

export interface SaveRevisionCheck<T> {
  record: string;
  /**
   * What the writer read. `null` means it read nothing there, and `undefined`
   * that it sent no revision.
   */
  expectedRevision: string | null | undefined;
  /** Refuse a write with no revision, for a value built from an earlier read. */
  requireRevision?: boolean;
  current: { value: T; revision: string | null };
  /** True when the current value already holds this write, so it's a repeat. */
  isSameSave: (current: T) => boolean;
}

/**
 * Decides a write against what's stored. The write itself must still be one
 * statement that fails if the value changed after this check.
 */
export function checkSaveRevision<T>({
  record,
  expectedRevision,
  requireRevision,
  current,
  isSameSave,
}: SaveRevisionCheck<T>): "apply" | "already_applied" {
  if (expectedRevision === undefined && !requireRevision) return "apply";
  if (expectedRevision === current.revision) return "apply";
  if (isSameSave(current.value)) {
    countSaveOutcome(record, "already_applied");
    return "already_applied";
  }
  throw saveConflict(record, current.value, current.revision);
}

/**
 * How many rows a write changed, from a count, a `returning()` list, a boolean
 * from a compare-and-set, or any driver's result. An unreadable result throws:
 * it must never read as a save that worked or one that lost.
 */
export function changedRowCount(result: unknown): number {
  if (typeof result === "number") return result;
  if (typeof result === "boolean") return result ? 1 : 0;
  if (result && typeof result === "object") {
    const counts = result as Record<string, unknown>;
    for (const key of [
      "rowsAffected",
      "affectedRows",
      "rowCount",
      "count",
      "changes",
    ]) {
      if (typeof counts[key] === "number") return counts[key];
    }
    if (Array.isArray(result)) return result.length;
  }
  throw new Error("Save could not confirm how many rows it changed.");
}

export interface SaveIfCurrentOptions<
  T,
  C extends { value: T; revision: string | null },
> extends Omit<SaveRevisionCheck<T>, "current" | "requireRevision"> {
  requireRevision?: boolean | ((current: C) => boolean);
  /** Reads what's stored. The read may carry more for `write` to use. */
  read: () => Promise<C>;
  /**
   * One statement that writes only if the value is still `current`, returning
   * anything {@link changedRowCount} can read.
   */
  write: (current: C) => Promise<unknown>;
}

/**
 * Saves a record only if nobody changed it since the writer read it. A stale
 * write throws the typed conflict, a repeat of an applied write changes nothing,
 * and a write that loses a race is checked again against what won it.
 */
export async function saveIfCurrent<
  T,
  C extends { value: T; revision: string | null },
>({
  record,
  expectedRevision,
  requireRevision,
  read,
  write,
  isSameSave,
}: SaveIfCurrentOptions<T, C>): Promise<{
  outcome: "written" | "already_applied";
  current: C;
}> {
  let current = await read();
  for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt += 1) {
    const decision = checkSaveRevision({
      record,
      expectedRevision,
      requireRevision:
        typeof requireRevision === "function"
          ? requireRevision(current)
          : requireRevision,
      current,
      isSameSave,
    });
    if (decision === "already_applied") {
      return { outcome: "already_applied", current };
    }
    const changed = changedRowCount(await write(current));
    if (changed === 1) {
      countSaveOutcome(record, "written");
      return { outcome: "written", current };
    }
    if (changed > 1) {
      throw new Error(`Save of ${record} changed ${changed} rows, not one.`);
    }
    current = await read();
  }
  throw saveConflict(record, current.value, current.revision);
}
