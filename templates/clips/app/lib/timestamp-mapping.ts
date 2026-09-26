export interface TrimRange {
  id?: string;
  startMs: number;
  endMs: number;
  excluded: boolean;
}

export type IdentifiedTrim = TrimRange & { id: string };

export interface BlurBox {
  id: string;
  startMs: number;
  endMs: number;
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
  stitchedFrom?: string[];
  mediaStorageLayout?: "external";
  rewindOriginalStartMs?: number;
  overlays?: unknown[];
  burnedRedactions?: unknown[];
}

export const DEFAULT_EDITS: EditsJson = {
  version: 1,
  trims: [],
  blurs: [],
  thumbnail: null,
};

export function parseEdits(raw: string | null | undefined): EditsJson {
  if (!raw) return { ...DEFAULT_EDITS };
  try {
    const j = JSON.parse(raw);
    if (!j || typeof j !== "object") return { ...DEFAULT_EDITS };
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

export function getExcludedRanges(edits: EditsJson): TrimRange[] {
  return normalizeExcluded(edits.trims.filter((t) => t.excluded));
}

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

export function originalToEdited(originalMs: number, edits: EditsJson): number {
  let skipped = 0;
  for (const range of getExcludedRanges(edits)) {
    if (originalMs <= range.startMs) break;
    const overlap = Math.min(originalMs, range.endMs) - range.startMs;
    skipped += Math.max(0, overlap);
  }
  return Math.max(0, originalMs - skipped);
}

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

export function isExcluded(originalMs: number, edits: EditsJson): boolean {
  for (const range of getExcludedRanges(edits)) {
    if (originalMs >= range.startMs && originalMs < range.endMs) return true;
  }
  return false;
}

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

export function lastKeptMs(
  durationMs: number,
  excluded: readonly Pick<TrimRange, "startMs" | "endMs">[],
): number {
  if (!(durationMs > 0)) return 0;
  let cursor = durationMs;
  for (const range of [...excluded].sort((a, b) => b.startMs - a.startMs)) {
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

export function popLastExcluded(edits: EditsJson): EditsJson {
  const excludedIndexes: number[] = [];
  edits.trims.forEach((t, i) => t.excluded && excludedIndexes.push(i));
  if (!excludedIndexes.length) return edits;
  const dropIndex = excludedIndexes[excludedIndexes.length - 1];
  return { ...edits, trims: edits.trims.filter((_, i) => i !== dropIndex) };
}

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

export interface TimelineClipPiece {
  kind: "clip";
  id: string;
  startMs: number;
  endMs: number;
}

export interface TimelineGapPiece {
  kind: "gap";
  id: string;
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

export function getCuts(edits: EditsJson): IdentifiedTrim[] {
  return mergeCuts(edits.trims.filter((t) => t.excluded));
}

export function getSplits(edits: EditsJson): IdentifiedTrim[] {
  return identifyTrims(edits.trims)
    .filter((t) => !t.excluded && t.startMs === t.endMs)
    .sort((a, b) => a.startMs - b.startMs);
}

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

function replaceCuts(edits: EditsJson, cuts: TrimRange[]): EditsJson {
  return withTrims(edits, [
    ...mergeCuts(cuts),
    ...edits.trims.filter((t) => !t.excluded),
  ]);
}

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

export function removeCut(edits: EditsJson, cutId: string): EditsJson {
  const cuts = getCuts(edits).filter((c) => c.id !== cutId);
  return replaceCuts(edits, cuts);
}

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

export function removeSplit(edits: EditsJson, splitId: string): EditsJson {
  return withTrims(
    edits,
    identifyTrims(edits.trims).filter((t) => t.excluded || t.id !== splitId),
  );
}
