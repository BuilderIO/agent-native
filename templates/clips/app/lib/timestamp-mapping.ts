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
  /**
   * Stable identity for this entry. Optional on the wire — anything written
   * before the segment editor landed has none, so `parseEdits` backfills a
   * deterministic one. The editor needs it to reopen a cut made minutes ago
   * and drag its edge, rather than only undoing the most recent one.
   */
  id?: string;
  startMs: number;
  endMs: number;
  /** If true, this range is skipped during playback. False = split marker. */
  excluded: boolean;
}

/** A trim that is guaranteed to carry an id — what the editor works with. */
export type IdentifiedTrim = TrimRange & { id: string };

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
  /** Provenance: source recording IDs when this recording was created via stitch-recordings. */
  stitchedFrom?: string[];
  /** Marks media URLs supplied outside the trusted recording upload pipeline. */
  mediaStorageLayout?: "external";
  /** Original countdown-complete boundary after an explicit Rewind pre-roll was prepended. */
  rewindOriginalStartMs?: number;
  /**
   * Things drawn over the picture rather than cut out of it — redaction boxes
   * today, text one day. Held loosely here because each kind validates itself:
   * `app/lib/video-redactions.ts` reads the redactions and ignores the rest.
   * Nothing in this list hides anything until it is burned into the file.
   */
  overlays?: unknown[];
  /**
   * Redactions that have been burned in: where they were and when it
   * happened, never what was underneath. Kept so the editor can show that a
   * stretch is already dealt with, and so a box whose pixels are gone is not
   * offered up for moving.
   */
  burnedRedactions?: unknown[];
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
    // Anything this version does not know about is carried through untouched.
    // `set-recording-trims` writes back what this returns, so a field written
    // by a newer client — text overlays, redaction boxes — would otherwise be
    // silently dropped the next time somebody moved a cut.
    const {
      version: _version,
      trims: _trims,
      blurs: _blurs,
      thumbnail: _thumbnail,
      stitchedFrom: _stitchedFrom,
      mediaStorageLayout: _mediaStorageLayout,
      rewindOriginalStartMs: _rewindOriginalStartMs,
      overlays: _overlays,
      burnedRedactions: _burnedRedactions,
      ...unknown
    } = j as Record<string, unknown>;
    return {
      ...unknown,
      version: 1,
      trims: Array.isArray(j.trims)
        ? (j.trims as TrimRange[]).filter(isValidTrim).map(withTrimId)
        : [],
      blurs: Array.isArray(j.blurs) ? (j.blurs as BlurBox[]) : [],
      thumbnail: j.thumbnail ?? null,
      ...(Array.isArray(j.stitchedFrom)
        ? { stitchedFrom: j.stitchedFrom as string[] }
        : {}),
      ...(j.mediaStorageLayout === "external"
        ? { mediaStorageLayout: "external" as const }
        : {}),
      ...(Array.isArray(j.overlays)
        ? { overlays: j.overlays as unknown[] }
        : {}),
      ...(Array.isArray(j.burnedRedactions)
        ? { burnedRedactions: j.burnedRedactions as unknown[] }
        : {}),
      ...(typeof j.rewindOriginalStartMs === "number" &&
      Number.isFinite(j.rewindOriginalStartMs) &&
      j.rewindOriginalStartMs > 0
        ? { rewindOriginalStartMs: Math.round(j.rewindOriginalStartMs) }
        : {}),
    };
  } catch {
    return { ...DEFAULT_EDITS };
  }
}

/**
 * Deterministic fallback id for a trim stored before ids existed. Index is
 * part of it so two identical split markers stay distinguishable; the id is
 * persisted on the next write, after which it no longer depends on position.
 */
export function makeTrimId(trim: TrimRange, index: number): string {
  const kind = trim.excluded ? "cut" : "split";
  return `${kind}-${Math.round(trim.startMs)}-${Math.round(trim.endMs)}-${index}`;
}

function withTrimId(trim: TrimRange, index: number): IdentifiedTrim {
  return {
    ...trim,
    id:
      typeof trim.id === "string" && trim.id
        ? trim.id
        : makeTrimId(trim, index),
  };
}

/** Assign ids to any trims still missing one (literals built in tests, mostly). */
export function identifyTrims(trims: TrimRange[]): IdentifiedTrim[] {
  return trims.map(withTrimId);
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

/** Move a source timestamp to the first visible timestamp after a cut. */
/**
 * The last moment a viewer is meant to see, given what has been trimmed.
 *
 * Trims are not baked into the file: the footage they remove is still there.
 * So playback that runs off the end of the kept footage carries on into the
 * removed tail, and whatever it lands on is original content a redaction drawn
 * against the *edited* video never covered.
 */
export function lastKeptMs(
  durationMs: number,
  excluded: readonly Pick<TrimRange, "startMs" | "endMs">[],
): number {
  if (!(durationMs > 0)) return 0;
  let cursor = durationMs;
  // Walked from the end backwards, so cuts that sit against one another chain:
  // trimming 8-9s and 9-10s of a ten-second clip leaves the last visible moment
  // at 8s, not 9s.
  for (const range of [...excluded].sort((a, b) => b.startMs - a.startMs)) {
    // A range that reaches the end pulls the last visible moment back to where
    // it begins; one that stops short of it does not.
    if (range.endMs >= cursor - 1 && range.startMs < cursor) {
      cursor = Math.max(0, range.startMs);
    }
  }
  return cursor;
}

export function skipExcludedRange(
  ms: number,
  excludedRanges: Pick<TrimRange, "startMs" | "endMs">[],
  durationMs: number,
): number {
  const range = excludedRanges.find(
    (candidate) => ms >= candidate.startMs && ms < candidate.endMs,
  );
  if (!range) return ms;
  const next = Math.max(ms, range.endMs);
  return durationMs > 0 ? Math.min(next, durationMs) : next;
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
  return withTrims(edits, [...excluded, ...splits]);
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
  return withTrims(edits, [
    ...edits.trims,
    { startMs: atMs, endMs: atMs, excluded: false },
  ]);
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

// ---------------------------------------------------------------------------
// Segment editing
//
// The timeline editor works in *pieces*: a run of kept footage is a "clip", a
// removed stretch is a "gap". Split markers subdivide clips without changing
// playback, so a user can cut a section out by splitting either side of it and
// deleting what's between. Every cut keeps its id, which is what makes an edit
// reopenable — you can grab the edge of a gap you made earlier and drag it.
// ---------------------------------------------------------------------------

export interface TimelineClipPiece {
  kind: "clip";
  /** Derived from the boundaries — changes as the piece is resized. */
  id: string;
  startMs: number;
  endMs: number;
}

export interface TimelineGapPiece {
  kind: "gap";
  id: string;
  /** Id of the trim entry this gap came from, for editing it in place. */
  cutId: string;
  startMs: number;
  endMs: number;
}

export type TimelinePiece = TimelineClipPiece | TimelineGapPiece;

function newCutId(): string {
  return `cut-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function newSplitId(): string {
  return `split-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Sort and merge the cut list. Overlapping or touching cuts collapse into one
 * — two gaps with nothing between them are one gap — and the earliest entry's
 * id survives, so the piece the user is dragging keeps its identity.
 */
export function mergeCuts(cuts: TrimRange[]): IdentifiedTrim[] {
  const sorted = identifyTrims(cuts)
    .filter((c) => c.endMs > c.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const out: IdentifiedTrim[] = [];
  for (const cut of sorted) {
    const prev = out[out.length - 1];
    if (prev && cut.startMs <= prev.endMs) {
      prev.endMs = Math.max(prev.endMs, cut.endMs);
    } else {
      out.push({ ...cut });
    }
  }
  return out;
}

/** The cuts (removed stretches), merged, sorted and id-bearing. */
export function getCuts(edits: EditsJson): IdentifiedTrim[] {
  return mergeCuts(edits.trims.filter((t) => t.excluded));
}

/** The split markers, sorted by position. */
export function getSplits(edits: EditsJson): IdentifiedTrim[] {
  return identifyTrims(edits.trims)
    .filter((t) => !t.excluded && t.startMs === t.endMs)
    .sort((a, b) => a.startMs - b.startMs);
}

/**
 * Whole milliseconds only. A drag reads its position off the pointer, which
 * lands on a fraction of a millisecond at any zoom level, and `id` aside the
 * stored trim list is integers — `set-recording-trims` rejects anything else.
 * Rounding here catches every mutation below rather than each call site.
 */
export function roundTrims(trims: TrimRange[]): TrimRange[] {
  return trims.map((t) =>
    Number.isInteger(t.startMs) && Number.isInteger(t.endMs)
      ? t
      : { ...t, startMs: Math.round(t.startMs), endMs: Math.round(t.endMs) },
  );
}

function withTrims(edits: EditsJson, trims: TrimRange[]): EditsJson {
  return { ...edits, trims: roundTrims(trims) };
}

/** Rebuild the trim list from a cut list, keeping every split marker as-is. */
function replaceCuts(edits: EditsJson, cuts: TrimRange[]): EditsJson {
  return withTrims(edits, [
    ...mergeCuts(cuts),
    ...edits.trims.filter((t) => !t.excluded),
  ]);
}

/**
 * Break the recording into the pieces the editor draws. Splits that fall
 * inside a gap are skipped — there is nothing there to divide.
 */
export function buildTimelinePieces(
  durationMs: number,
  edits: EditsJson,
): TimelinePiece[] {
  if (!(durationMs > 0)) return [];
  const cuts = getCuts(edits).filter((c) => c.startMs < durationMs);
  const splitPoints = getSplits(edits)
    .map((s) => s.startMs)
    .filter((ms) => ms > 0 && ms < durationMs);

  const pieces: TimelinePiece[] = [];
  let cursor = 0;

  const pushClips = (fromMs: number, toMs: number) => {
    if (toMs <= fromMs) return;
    const inner = [
      ...new Set(splitPoints.filter((ms) => ms > fromMs && ms < toMs)),
    ].sort((a, b) => a - b);
    let start = fromMs;
    for (const ms of [...inner, toMs]) {
      pieces.push({
        kind: "clip",
        id: `clip-${Math.round(start)}-${Math.round(ms)}`,
        startMs: start,
        endMs: ms,
      });
      start = ms;
    }
  };

  for (const cut of cuts) {
    const start = Math.max(cursor, cut.startMs);
    const end = Math.min(durationMs, cut.endMs);
    if (end <= cursor) continue;
    pushClips(cursor, start);
    pieces.push({
      kind: "gap",
      id: `gap-${cut.id}`,
      cutId: cut.id,
      startMs: start,
      endMs: end,
    });
    cursor = end;
  }
  pushClips(cursor, durationMs);

  return pieces;
}

/**
 * The split markers worth drawing: the ones that still divide footage.
 *
 * A marker swallowed by a cut divides nothing — there is no footage either
 * side of it any more — and one sitting on the very start or end of the
 * recording never did. Both are kept in the document, because shrinking the
 * cut back hands the division over again, but drawing them leaves a red line
 * stranded inside a removed stretch, which reads as an edit that would not go
 * away.
 */
export function visibleSplitPoints(
  edits: EditsJson,
  durationMs: number,
): number[] {
  const cuts = getCuts(edits);
  return getSplits(edits)
    .map((split) => split.startMs)
    .filter((ms) => ms > 0 && ms < durationMs)
    .filter((ms) => !cuts.some((cut) => ms > cut.startMs && ms < cut.endMs));
}

/** Remove a stretch of footage. Overlapping cuts merge into the new one. */
export function addCut(
  edits: EditsJson,
  startMs: number,
  endMs: number,
  id: string = newCutId(),
): EditsJson {
  const lo = Math.max(0, Math.min(startMs, endMs));
  const hi = Math.max(startMs, endMs);
  if (hi <= lo) return edits;
  return replaceCuts(edits, [
    ...edits.trims.filter((t) => t.excluded),
    { id, startMs: lo, endMs: hi, excluded: true },
  ]);
}

/**
 * Move one cut's edges. Dragging an edge inward removes more footage, outward
 * restores it; dragging it shut removes the cut entirely.
 */
export function updateCut(
  edits: EditsJson,
  cutId: string,
  startMs: number,
  endMs: number,
): EditsJson {
  const lo = Math.max(0, Math.min(startMs, endMs));
  const hi = Math.max(startMs, endMs);
  const cuts = getCuts(edits);
  if (!cuts.some((c) => c.id === cutId)) return edits;
  if (hi <= lo) return removeCut(edits, cutId);
  return replaceCuts(
    edits,
    cuts.map((c) => (c.id === cutId ? { ...c, startMs: lo, endMs: hi } : c)),
  );
}

/** Put a removed stretch back. */
export function removeCut(edits: EditsJson, cutId: string): EditsJson {
  const cuts = getCuts(edits).filter((c) => c.id !== cutId);
  return replaceCuts(edits, cuts);
}

/**
 * Drop a split marker. Splits closer together than `minGapMs` collapse onto
 * the existing one, so a double-tap of the cut key does not stack markers.
 */
export function addSplitAt(
  edits: EditsJson,
  atMs: number,
  id: string = newSplitId(),
  minGapMs = 1,
): EditsJson {
  const at = Math.max(0, Math.round(atMs));
  if (getSplits(edits).some((s) => Math.abs(s.startMs - at) < minGapMs)) {
    return edits;
  }
  return withTrims(edits, [
    ...edits.trims,
    { id, startMs: at, endMs: at, excluded: false },
  ]);
}

/** Slide a split marker to a new position. */
export function moveSplit(
  edits: EditsJson,
  splitId: string,
  atMs: number,
): EditsJson {
  const at = Math.max(0, Math.round(atMs));
  return withTrims(
    edits,
    identifyTrims(edits.trims).map((t) =>
      t.id === splitId && !t.excluded ? { ...t, startMs: at, endMs: at } : t,
    ),
  );
}

/** Remove a split marker, rejoining the two clips it divided. */
export function removeSplit(edits: EditsJson, splitId: string): EditsJson {
  return withTrims(
    edits,
    identifyTrims(edits.trims).filter((t) => t.excluded || t.id !== splitId),
  );
}
