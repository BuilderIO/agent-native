/** set-chapters' errorCode when the stored list isn't the one expected. */
export const CHAPTERS_CHANGED = "chapters_changed";

export type StoredChapter = { startMs: number; title: string };

/**
 * A recording's chapters as the player shows them. set-chapters compares an
 * editor's `expectedChapters` against this, so both must read it the same
 * way.
 */
export function parseStoredChapters(
  chaptersJson: string | null | undefined,
): StoredChapter[] {
  try {
    const parsed = JSON.parse(chaptersJson ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (c: any) =>
          typeof c?.startMs === "number" && typeof c?.title === "string",
      )
      .map((c: any) => ({ startMs: c.startMs, title: c.title }));
  } catch {
    // coercion-ok: unreadable chapters show as none, and an editor may save
    // a fresh list over them.
    return [];
  }
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
