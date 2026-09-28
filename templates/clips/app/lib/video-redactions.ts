export interface RedactionKey {
  atMs: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type RedactionRect = Omit<RedactionKey, "atMs">;

export interface VideoRedaction {
  id: string;
  kind: "redact";
  style: RedactionStyle;
  color?: string;
  startMs: number;
  endMs: number;
  keys: RedactionKey[];
}

export type RedactionStyle = "mosaic" | "solid";

export const DEFAULT_REDACTION_STYLE: RedactionStyle = "mosaic";

/** Redaction black: unmistakably deliberate over any footage. */
// guard:allow-raw-color — an ffmpeg argument, not styling: this is burned into a video file that has no theme to follow.
export const DEFAULT_REDACTION_COLOR = "#0b0f19";
/** Tone a mosaic is built in when none was chosen. */
// guard:allow-raw-color — an ffmpeg argument, as above.
export const DEFAULT_MOSAIC_TONE = "#8a8f98";
export const MOSAIC_PALETTE = [
  // guard:allow-raw-color — an ffmpeg argument, not styling.
  "#ffffff",
  // guard:allow-raw-color — an ffmpeg argument, not styling.
  "#f4f5f7",
  // guard:allow-raw-color — an ffmpeg argument, not styling.
  "#e9ebee",
  // guard:allow-raw-color — an ffmpeg argument, not styling.
  "#dee1e5",
  // guard:allow-raw-color — an ffmpeg argument, not styling.
  "#d3d7dc",
  // guard:allow-raw-color — an ffmpeg argument, not styling.
  "#c8ccd3",
  // guard:allow-raw-color — an ffmpeg argument, not styling.
  "#bdc2ca",
  // guard:allow-raw-color — an ffmpeg argument, not styling.
  "#b2b8c1",
] as const;

export const STREAK_ASPECT = 3;
export const STREAK_SIGMA = 1;

export function streakUnitPx(frameWidth: number | undefined): number {
  const width = frameWidth && frameWidth > 0 ? frameWidth : 1280;
  return Math.max(8, Math.min(120, Math.round(width / 56)));
}
/**
 * The border. Mid grey rather than white: the blur's palette runs from light
 * grey up to white, and a white border on a white block is no border at all.
 * It still reads against the solid style's near-black fill.
 */
// guard:allow-raw-color — an ffmpeg argument, as above.
export const REDACTION_EDGE_COLOR = "0x8a9099";

export function mosaicBlockPx(frameWidth: number | undefined): number {
  const width =
    Number.isFinite(frameWidth) && (frameWidth ?? 0) > 0
      ? (frameWidth as number)
      : 1280;
  return Math.max(16, Math.min(160, Math.round(width / 40)));
}

export const MIN_REDACTION_SIZE = 0.005;
export const KEY_MERGE_TOLERANCE_MS = 120;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function normalizeRect(rect: RedactionRect): RedactionRect {
  const x = clamp01(rect.x);
  const y = clamp01(rect.y);
  return {
    x,
    y,
    w: Math.min(clamp01(rect.w), 1 - x),
    h: Math.min(clamp01(rect.h), 1 - y),
  };
}

function parseKey(raw: unknown): RedactionKey | null {
  if (!raw || typeof raw !== "object") return null;
  const k = raw as Record<string, unknown>;
  const nums = [k.atMs, k.x, k.y, k.w, k.h];
  if (nums.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
    return null;
  }
  const rect = normalizeRect({
    x: k.x as number,
    y: k.y as number,
    w: k.w as number,
    h: k.h as number,
  });
  if (rect.w < MIN_REDACTION_SIZE || rect.h < MIN_REDACTION_SIZE) return null;
  return { atMs: Math.max(0, Math.round(k.atMs as number)), ...rect };
}

export function parseRedactions(raw: unknown): VideoRedaction[] {
  if (!Array.isArray(raw)) return [];
  const out: VideoRedaction[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (o.kind !== "redact") continue;
    if (typeof o.id !== "string" || !o.id) continue;
    if (typeof o.startMs !== "number" || typeof o.endMs !== "number") continue;
    const style: RedactionStyle = o.style === "solid" ? "solid" : "mosaic";
    const keys = Array.isArray(o.keys)
      ? o.keys.map(parseKey).filter((k): k is RedactionKey => k !== null)
      : [];
    if (!keys.length) continue;
    const startMs = Math.max(0, Math.round(o.startMs));
    const endMs = Math.max(startMs, Math.round(o.endMs));
    if (endMs <= startMs) continue;
    out.push({
      id: o.id,
      kind: "redact",
      style,
      ...(isHexColor(o.color) ? { color: o.color } : {}),
      startMs,
      endMs,
      keys: [...keys].sort((a, b) => a.atMs - b.atMs),
    });
  }
  return out.sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
}

export function otherOverlays(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item) =>
      !item ||
      typeof item !== "object" ||
      (item as Record<string, unknown>).kind !== "redact",
  );
}

export function redactionRectAt(
  redaction: VideoRedaction,
  atMs: number,
): RedactionRect {
  const keys = redaction.keys;
  if (keys.length === 1 || atMs <= keys[0].atMs) return rectOf(keys[0]);
  const last = keys[keys.length - 1];
  if (atMs >= last.atMs) return rectOf(last);

  for (let i = 0; i < keys.length - 1; i++) {
    const from = keys[i];
    const to = keys[i + 1];
    if (atMs < from.atMs || atMs > to.atMs) continue;
    const span = to.atMs - from.atMs;
    const ratio = span > 0 ? (atMs - from.atMs) / span : 0;
    return {
      x: from.x + (to.x - from.x) * ratio,
      y: from.y + (to.y - from.y) * ratio,
      w: from.w + (to.w - from.w) * ratio,
      h: from.h + (to.h - from.h) * ratio,
    };
  }
  return rectOf(last);
}

function rectOf(key: RedactionKey): RedactionRect {
  return { x: key.x, y: key.y, w: key.w, h: key.h };
}

export function isRedactionActiveAt(
  redaction: VideoRedaction,
  atMs: number,
): boolean {
  return atMs >= redaction.startMs && atMs < redaction.endMs;
}

export function setRedactionKey(
  redaction: VideoRedaction,
  atMs: number,
  rect: RedactionRect,
  toleranceMs: number = KEY_MERGE_TOLERANCE_MS,
): VideoRedaction {
  const at = Math.max(0, Math.round(atMs));
  const key: RedactionKey = { atMs: at, ...normalizeRect(rect) };
  const kept = redaction.keys.filter(
    (k) => Math.abs(k.atMs - at) > toleranceMs,
  );
  return {
    ...redaction,
    keys: [...kept, key].sort((a, b) => a.atMs - b.atMs),
  };
}

export function moveRedactionKey(
  redaction: VideoRedaction,
  fromMs: number,
  toMs: number,
  toleranceMs: number = KEY_MERGE_TOLERANCE_MS,
): VideoRedaction {
  const key = redaction.keys.find((k) => k.atMs === fromMs);
  if (!key) return redaction;
  const at = Math.max(0, Math.round(toMs));
  const others = redaction.keys.filter(
    (k) => k.atMs !== fromMs && Math.abs(k.atMs - at) > toleranceMs,
  );
  return {
    ...redaction,
    keys: [...others, { ...key, atMs: at }].sort((a, b) => a.atMs - b.atMs),
  };
}

export function removeRedactionKey(
  redaction: VideoRedaction,
  atMs: number,
): VideoRedaction {
  if (redaction.keys.length <= 1) return redaction;
  const keys = redaction.keys.filter((k) => k.atMs !== atMs);
  return keys.length ? { ...redaction, keys } : redaction;
}

export function setRedactionRange(
  redaction: VideoRedaction,
  startMs: number,
  endMs: number,
): VideoRedaction {
  const start = Math.max(0, Math.round(Math.min(startMs, endMs)));
  const end = Math.max(start, Math.round(Math.max(startMs, endMs)));
  return { ...redaction, startMs: start, endMs: end };
}

export const MIN_REDACTION_MS = 200;

export function clampRedactionToDuration(
  redaction: VideoRedaction,
  durationMs: number,
): VideoRedaction {
  if (!(durationMs > 0)) return redaction;
  const duration = Math.round(durationMs);

  let startMs = redaction.startMs;
  let endMs = redaction.endMs;

  if (startMs >= duration) {
    const length = Math.min(
      Math.max(MIN_REDACTION_MS, endMs - startMs),
      duration,
    );
    startMs = duration - length;
    endMs = duration;
  } else {
    endMs = Math.min(endMs, duration);
    if (endMs - startMs < MIN_REDACTION_MS) {
      startMs = Math.max(0, endMs - MIN_REDACTION_MS);
    }
  }

  return startMs === redaction.startMs && endMs === redaction.endMs
    ? redaction
    : { ...redaction, startMs, endMs };
}

export function newRedactionId(): string {
  return `redact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface RedactionSegment {
  fromMs: number;
  toMs: number;
  from: RedactionRect;
  to: RedactionRect;
}

export function unionRect(a: RedactionRect, b: RedactionRect): RedactionRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

export function redactionSegments(
  redaction: VideoRedaction,
  durationMs?: number,
): RedactionSegment[] {
  const start = redaction.startMs;
  const end =
    typeof durationMs === "number" && durationMs > 0
      ? Math.min(redaction.endMs, Math.round(durationMs))
      : redaction.endMs;
  if (end <= start) return [];

  const cuts = new Set<number>([start, end]);
  for (const key of redaction.keys) {
    if (key.atMs > start && key.atMs < end) cuts.add(key.atMs);
  }
  const points = [...cuts].sort((a, b) => a - b);

  const segments: RedactionSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    segments.push({
      fromMs: points[i],
      toMs: points[i + 1],
      from: redactionRectAt(redaction, points[i]),
      to: redactionRectAt(redaction, points[i + 1]),
    });
  }
  return segments;
}

export interface RedactionFilterGraph {
  filterComplex: string;
  outputLabel: string;
}

export function redactionEdgePx(frameWidth: number | undefined): number {
  const width = frameWidth && frameWidth > 0 ? frameWidth : 1280;
  return Math.max(2, Math.min(8, Math.round(width / 480)));
}

function mosaicChain(
  piece: string,
  destroyed: string,
  size: RedactionRect,
  frameWidth: number,
  frameHeight: number,
  seed: number,
): string {
  if (!(frameWidth > 0) || !(frameHeight > 0)) {
    throw new Error(
      "A redaction needs the frame size to be known before it can be drawn.",
    );
  }
  const boxW = Math.max(1, Math.ceil(frameWidth * size.w));
  const boxH = Math.max(1, Math.ceil(frameHeight * size.h));

  const blockH = streakUnitPx(frameWidth);
  const blockW = blockH * STREAK_ASPECT;
  const lowW = Math.max(1, Math.ceil(boxW / blockW));
  const lowH = Math.max(1, Math.ceil(boxH / blockH));
  const fullW = lowW * blockW;
  const fullH = lowH * blockH;

  const index = `mod(floor(abs(sin((X+1)*12.9898+(Y+1)*78.233+${seed})*43758.5453)),${MOSAIC_PALETTE.length})`;
  const channel = (offset: number) => {
    const values = MOSAIC_PALETTE.map((hex) =>
      parseInt(hex.slice(1 + offset * 2, 3 + offset * 2), 16),
    );
    return values.reduceRight(
      (rest, value, at) =>
        at === values.length - 1
          ? `${value}`
          : `if(eq(${index},${at}),${value},${rest})`,
      "",
    );
  };

  return (
    `[${piece}]scale=${lowW}:${lowH}:flags=neighbor,` +
    `geq=r='${channel(0)}':g='${channel(1)}':b='${channel(2)}',` +
    `scale=${fullW}:${fullH}:flags=neighbor,` +
    `gblur=sigma=${(blockH * STREAK_SIGMA).toFixed(1)}:steps=3,` +
    `crop=${boxW}:${boxH}:0:0,` +
    `drawbox=x=0:y=0:w=iw:h=ih:color=${REDACTION_EDGE_COLOR}@1:` +
    `t=${redactionEdgePx(frameWidth)}[${destroyed}]`
  );
}

function seg(ms: number): string {
  return (ms / 1000).toFixed(3);
}

function ffmpegColor(color: string | undefined): string {
  const hex = isHexColor(color) ? color : DEFAULT_REDACTION_COLOR;
  return `0x${hex.slice(1).toLowerCase()}`;
}

function travelExpr(
  dim: string,
  extent: string,
  from: number,
  to: number,
  fromMs: number,
  toMs: number,
): string {
  const a = from.toFixed(6);
  const moving = Math.abs(to - from) > 1e-6 && toMs > fromMs;
  const position = moving
    ? `${dim}*(${a}+(${((to - from) / ((toMs - fromMs) / 1000)).toFixed(
        6,
      )})*(t-${seg(fromMs)}))`
    : `${dim}*${a}`;
  return `min(max(${position},0),${dim}-${extent})`;
}

export function redactionFilterGraph(
  redactions: VideoRedaction[],
  durationMs?: number,
  frameWidth?: number,
  frameHeight?: number,
  seed = 1,
): RedactionFilterGraph {
  const work: Array<{ redaction: VideoRedaction; segment: RedactionSegment }> =
    [];
  for (const redaction of redactions) {
    for (const segment of redactionSegments(redaction, durationMs)) {
      work.push({ redaction, segment });
    }
  }
  if (!work.length) return { filterComplex: "", outputLabel: "0:v" };

  const parts: string[] = [];
  const sources = ["rbase", ...work.map((_, i) => `rsrc${i}`)];
  parts.push(
    `[0:v]split=${sources.length}${sources.map((l) => `[${l}]`).join("")}`,
  );

  let current = "rbase";
  work.forEach(({ redaction, segment }, index) => {
    const size = unionRect(segment.from, segment.to);
    const piece = `rc${index}`;
    const destroyed = `rd${index}`;
    const out = `rv${index}`;

    parts.push(
      `[rsrc${index}]crop=w='iw*${size.w.toFixed(6)}':h='ih*${size.h.toFixed(6)}':` +
        `x='${travelExpr("iw", "out_w", segment.from.x, segment.to.x, segment.fromMs, segment.toMs)}':` +
        `y='${travelExpr("ih", "out_h", segment.from.y, segment.to.y, segment.fromMs, segment.toMs)}'[${piece}]`,
    );
    parts.push(
      redaction.style === "solid"
        ? `[${piece}]drawbox=x=0:y=0:w=iw:h=ih:` +
            `color=${ffmpegColor(redaction.color)}@1:t=fill,` +
            `drawbox=x=0:y=0:w=iw:h=ih:` +
            `color=${REDACTION_EDGE_COLOR}@1:` +
            `t=${redactionEdgePx(frameWidth)}[${destroyed}]`
        : mosaicChain(
            piece,
            destroyed,
            size,
            frameWidth ?? 0,
            frameHeight ?? 0,
            seed + index,
          ),
    );
    parts.push(
      `[${current}][${destroyed}]overlay=eval=frame:` +
        `x='${travelExpr("W", "w", segment.from.x, segment.to.x, segment.fromMs, segment.toMs)}':` +
        `y='${travelExpr("H", "h", segment.from.y, segment.to.y, segment.fromMs, segment.toMs)}':` +
        `enable='between(t,${seg(segment.fromMs)},${seg(segment.toMs)})'[${out}]`,
    );
    current = out;
  });

  return { filterComplex: parts.join(";"), outputLabel: current };
}

export const MAX_BURN_FPS = 60;

export function redactionBurnFfmpegArgs(input: {
  inputPath: string;
  outputPath: string;
  filterComplex: string;
  outputLabel: string;
}): string[] {
  const filterComplex =
    `${input.filterComplex};` +
    `[${input.outputLabel}]fps=fps=min(${MAX_BURN_FPS}\\,source_fps)[rvout]`;

  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-i",
    input.inputPath,
    "-filter_complex",
    filterComplex,
    "-map",
    "[rvout]",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    input.outputPath,
  ];
}
