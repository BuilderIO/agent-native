/** set-chapters' errorCode when the stored list isn't the one expected. */
export const CHAPTERS_CHANGED = "chapters_changed";
/** set-chapters' errorCode when guarded updates kept missing; safe to retry. */
export const CHAPTERS_BUSY = "chapters_busy";
/** set-chapters' errorCode when a save names no list it started from. */
export const EXPECTED_CHAPTERS_REQUIRED = "expected_chapters_required";
/** set-chapters' errorCode when a guarded save would delete unreadable entries. */
export const CHAPTERS_UNREADABLE = "chapters_unreadable";

export type StoredChapter = { startMs: number; title: string };

/** set-chapters only takes whole, non-negative milliseconds. */
export function storableMs(ms: number): number {
  return Math.max(0, Math.round(ms));
}

/** How a chapter save failed, for the message the editor shows. */
export function chapterSaveFailure(
  err: unknown,
): "changed" | "unreadable" | "failed" {
  const code = (err as { errorCode?: unknown } | null)?.errorCode;
  if (code === CHAPTERS_CHANGED) return "changed";
  if (code === CHAPTERS_UNREADABLE) return "unreadable";
  return "failed";
}

/**
 * A recording's chapters as the player shows them, and whether the stored
 * value held anything that can't be shown that way: JSON that doesn't
 * parse, a non-list, or malformed entries. set-chapters compares an
 * editor's `expectedChapters` against `chapters`, so both must read it the
 * same way, and refuses a guarded save over an unreadable value, which it
 * would otherwise delete unseen.
 */
export function readStoredChapters(chaptersJson: string | null | undefined): {
  chapters: StoredChapter[];
  unreadable: boolean;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(chaptersJson ?? "[]");
  } catch {
    return { chapters: [], unreadable: true };
  }
  if (!Array.isArray(parsed)) return { chapters: [], unreadable: true };
  const chapters = parsed
    .filter(
      (c: any) => Number.isFinite(c?.startMs) && typeof c?.title === "string",
    )
    .map((c: any) => ({ startMs: c.startMs, title: c.title }));
  return {
    chapters,
    // A time no save could keep (1e300, say) counts too: every edit would
    // otherwise fail without saying why.
    unreadable:
      chapters.length !== parsed.length ||
      chapters.some((c) => !Number.isSafeInteger(storableMs(c.startMs))),
  };
}

/** The chapters readStoredChapters can show. */
export function parseStoredChapters(
  chaptersJson: string | null | undefined,
): StoredChapter[] {
  // coercion-ok: the player shows unreadable chapters as none, as before;
  // set-chapters reads `unreadable` and refuses a guarded save over them.
  return readStoredChapters(chaptersJson).chapters;
}

export function sameChapters(
  a: readonly StoredChapter[],
  b: readonly StoredChapter[],
): boolean {
  return (
    a.length === b.length &&
    a.every((c, i) => c.startMs === b[i].startMs && c.title === b[i].title)
  );
}

export function sameCuts(
  a: readonly { startMs: number; endMs: number }[],
  b: readonly { startMs: number; endMs: number }[],
): boolean {
  return (
    a.length === b.length &&
    a.every((r, i) => r.startMs === b[i].startMs && r.endMs === b[i].endMs)
  );
}
