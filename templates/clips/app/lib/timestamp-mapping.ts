/**
 * Timestamp mapping helpers — used by both the player and the editor.
 *
 * The source video is never re-encoded. All edits live in `recordings.edits_json`
 * as a ripple-style list of trim ranges. When edits declare an `excluded` range,
 * playback skips that range — effectively shortening the video.
 *
 * Two timelines exist:
 *  - ORIGINAL time: the real video timestamp (0 to recording.durationMs).
 *    Transcript segments, comments, and reactions are all stored in original time.
 *  - EDITED time: the playback-visible timeline after excluded ranges are removed.
 *
 * Helpers here convert between the two. Non-excluded trim entries (splits) do
 * not shift time — they're only UI markers.
 */

export interface TrimRange {
  startMs: number;
  endMs: number;
  /** If true, this range is skipped during playback. False = split marker. */
  excluded: boolean;
}

export interface BlurBox {
  id: string;
  startMs: number;
  endMs: number;
  /** Normalized 0-1 coords relative to video dimensions. */
  x: number;
  y: number;
  w: number;
  h: number;
  intensity: number;
}

export interface ThumbnailSpec {
  kind: "url" | "frame" | "gif";
  value: string;
}

export interface EditsJson {
  version: 1;
  trims: TrimRange[];
  blurs: BlurBox[];
  thumbnail?: ThumbnailSpec | null;
}

export const DEFAULT_EDITS: EditsJson = {
  version: 1,
  trims: [],
  blurs: [],
  thumbnail: null,
};

/**
 * Parse `recording.editsJson` (a TEXT column) into an EditsJson object.
 * Accepts missing fields and returns fully-populated defaults.
 */
export function parseEdits(raw: string | null | undefined): EditsJson {
  if (!raw) return { ...DEFAULT_EDITS };
  try {
    const j = JSON.parse(raw);
    if (!j || typeof j !== "object") return { ...DEFAULT_EDITS };
    return {
      version: 1,
      trims: Array.isArray(j.trims)
        ? (j.trims as TrimRange[]).filter(isValidTrim)
        : [],
      blurs: Array.isArray(j.blurs) ? (j.blurs as BlurBox[]) : [],
      thumbnail: j.thumbnail ?? null,
    };
  } catch {
    return { ...DEFAULT_EDITS };
  }
}

function isValidTrim(t: any): t is TrimRange {
  return (
    t &&
    typeof t.startMs === "number" &&
    typeof t.endMs === "number" &&
    t.startMs <= t.endMs
  );
}

export function serializeEdits(edits: EditsJson): string {
  return JSON.stringify(edits);
}

/** Return ONLY the excluded ranges, sorted and non-overlapping. */
export function getExcludedRanges(edits: EditsJson): TrimRange[] {
  return normalizeExcluded(edits.trims.filter((t) => t.excluded));
}

/** Merge adjacent/overlapping excluded ranges so downstream logic can rely on a clean list. */
export function normalizeExcluded(ranges: TrimRange[]): TrimRange[] {
  if (!ranges.length) return [];
  const sorted = [...ranges]
    .map((r) => ({ ...r }))
    .sort((a, b) => a.startMs - b.startMs);
  const out: TrimRange[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = out[out.length - 1];
    const cur = sorted[i];
    if (cur.startMs <= prev.endMs) {
      prev.endMs = Math.max(prev.endMs, cur.endMs);
    } else {
      out.push(cur);
    }
  }
  return out;
}

/**
 * Map an ORIGINAL timestamp to the EDITED timeline. Timestamps that fall
 * inside an excluded range snap to the start of that range on the edited timeline.
 */
export function originalToEdited(originalMs: number, edits: EditsJson): number {
  let skipped = 0;
  for (const range of getExcludedRanges(edits)) {
    if (originalMs <= range.startMs) break;
    const overlap = Math.min(originalMs, range.endMs) - range.startMs;
    skipped += Math.max(0, overlap);
  }
  return Math.max(0, originalMs - skipped);
}

/**
 * Map an EDITED timestamp back to the ORIGINAL timeline. Used when the player
 * reports an "edited" time and we need to know what real second of the video
 * we're at (e.g., to show the transcript, to seek the underlying <video>).
 */
export function editedToOriginal(editedMs: number, edits: EditsJson): number {
  let cursor = 0;
  let remaining = editedMs;
  for (const range of getExcludedRanges(edits)) {
    const visibleBefore = range.startMs - cursor;
    if (remaining < visibleBefore) return cursor + remaining;
    remaining -= visibleBefore;
    cursor = range.endMs;
  }
  return cursor + remaining;
}

/** Effective duration after removing excluded ranges. */
export function effectiveDuration(
  durationMs: number,
  edits: EditsJson,
): number {
  let excluded = 0;
  for (const range of getExcludedRanges(edits)) {
    excluded += Math.max(
      0,
      Math.min(range.endMs, durationMs) - Math.max(range.startMs, 0),
    );
  }
  return Math.max(0, durationMs - excluded);
}

/**
 * True if the given original timestamp falls inside an excluded range.
 * Useful for rendering strikethrough transcript segments.
 */
export function isExcluded(originalMs: number, edits: EditsJson): boolean {
  for (const range of getExcludedRanges(edits)) {
    if (originalMs >= range.startMs && originalMs < range.endMs) return true;
  }
  return false;
}

/**
 * Build a playback sequence of "kept" ranges in original time. The player
 * iterates these and seeks the underlying <video> whenever playback crosses
 * the end of a kept range.
 */
export interface KeptRange {
  startMs: number;
  endMs: number;
}

export function getKeptRanges(
  durationMs: number,
  edits: EditsJson,
): KeptRange[] {
  const out: KeptRange[] = [];
  let cursor = 0;
  for (const range of getExcludedRanges(edits)) {
    if (range.startMs > cursor)
      out.push({ startMs: cursor, endMs: range.startMs });
    cursor = Math.max(cursor, range.endMs);
  }
  if (cursor < durationMs) out.push({ startMs: cursor, endMs: durationMs });
  return out;
}

/**
 * Merge a new excluded range into the edits, collapsing adjacent/overlapping
 * entries. Preserves existing non-excluded (split) markers as-is.
 */
export function mergeExcluded(
  edits: EditsJson,
  startMs: number,
  endMs: number,
): EditsJson {
  const clamped = {
    startMs: Math.max(0, Math.min(startMs, endMs)),
    endMs: Math.max(0, Math.max(startMs, endMs)),
    excluded: true,
  };
  const excluded = normalizeExcluded([
    ...edits.trims.filter((t) => t.excluded),
    clamped,
  ]);
  const splits = edits.trims.filter((t) => !t.excluded);
  return { ...edits, trims: [...excluded, ...splits] };
}

/** Remove the most recently-added excluded range (LIFO). */
export function popLastExcluded(edits: EditsJson): EditsJson {
  const excludedIndexes: number[] = [];
  edits.trims.forEach((t, i) => t.excluded && excludedIndexes.push(i));
  if (!excludedIndexes.length) return edits;
  const dropIndex = excludedIndexes[excludedIndexes.length - 1];
  return { ...edits, trims: edits.trims.filter((_, i) => i !== dropIndex) };
}

/** Append a split marker (non-excluded, zero-width) at the given ms. */
export function appendSplit(edits: EditsJson, atMs: number): EditsJson {
  return {
    ...edits,
    trims: [...edits.trims, { startMs: atMs, endMs: atMs, excluded: false }],
  };
}

export function formatMs(ms: number): string {
  if (!isFinite(ms) || ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mmss = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}
