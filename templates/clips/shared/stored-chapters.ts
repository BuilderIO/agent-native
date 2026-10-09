/** set-chapters' errorCode when the stored list isn't the one expected. */
export const CHAPTERS_CHANGED = "chapters_changed";
/** set-chapters' errorCode when guarded updates kept missing; safe to retry. */
export const CHAPTERS_BUSY = "chapters_busy";
/** set-chapters' errorCode when a guarded save would delete unreadable entries. */
export const CHAPTERS_UNREADABLE = "chapters_unreadable";

export type StoredChapter = { startMs: number; title: string };

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
      (c: any) =>
        typeof c?.startMs === "number" && typeof c?.title === "string",
    )
    .map((c: any) => ({ startMs: c.startMs, title: c.title }));
  return { chapters, unreadable: chapters.length !== parsed.length };
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
