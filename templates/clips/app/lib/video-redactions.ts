/**
 * Redactions on a video: a rectangle that covers part of the picture for a
 * stretch of time, and can move while it is there.
 *
 * Three things drive the design.
 *
 * **A redaction is not real until it is burned in.** A box drawn over a
 * playing video is decoration — the stored file still has the pixels, and
 * anyone can read them from the network tab, a download, the poster image or
 * the editor's filmstrip. So these live in `editsJson.overlays` while they are
 * being placed, and `burn-recording-redactions` renders them into a new file
 * and deletes the old one. Until that runs, nothing is hidden from anybody.
 *
 * **Solid fill, not blur.** A Gaussian blur is a reversible convolution, and a
 * mosaic of a short guessable string can be attacked by rendering candidates
 * and comparing blocks. `app/lib/screenshot-redaction.ts` has the long version
 * of this argument; the conclusion is the same here, and a video gives an
 * attacker many frames of the same region to work with, which only helps them.
 *
 * **It can move, but it cannot follow.** Nothing here tracks content. A
 * redaction carries a list of positions in time and slides between them, so a
 * box can follow a scroll the user has traced by hand. One position means it
 * stays put. On a fast movement the interpolation can lag the content by a
 * frame or two, which is why the editor says to draw the box larger than the
 * thing it covers.
 *
 * Coordinates are normalized 0–1 against the video's own dimensions, like
 * `blurs`, so they survive any display size and any re-encode.
 */

/** Where a redaction sits at one moment. Normalized 0–1. */
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
  /**
   * `mosaic` averages the area into coarse blocks, which reads as the blur
   * people expect and keeps the shape of what was there. `solid` removes even
   * the average colour, and is the right choice for a short guessable string —
   * a password, a key, an account number — where an attacker can render
   * candidates, pixelate them the same way and compare the blocks.
   */
  style: RedactionStyle;
  /** Hex fill. Defaults to redaction black. */
  color?: string;
  startMs: number;
  endMs: number;
  /** At least one, sorted by `atMs`. One key is a box that does not move. */
  keys: RedactionKey[];
}

/** How the area is destroyed. Mirrors the screenshot editor's two choices. */
export type RedactionStyle = "mosaic" | "solid";

/** What the screenshot editor defaults to, for the same reasons. */
export const DEFAULT_REDACTION_STYLE: RedactionStyle = "mosaic";

/** Redaction black: unmistakably deliberate over any footage. */
// guard:allow-raw-color — an ffmpeg argument, not styling: this is burned into a video file that has no theme to follow.
export const DEFAULT_REDACTION_COLOR = "#0b0f19";
/** Tone a mosaic is built in when none was chosen. */
// guard:allow-raw-color — an ffmpeg argument, as above.
export const DEFAULT_MOSAIC_TONE = "#8a8f98";
/**
 * The redaction's palette — light greys through to white (Pete's choice,
 * 2026-09-22). The blocks are drawn from this rather than from the picture, so
 * the set is a free choice; it only has to read as a deliberate redaction
 * rather than as a fault in the video.
 */
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

/**
 * The streak: blocks three times wider than they are tall, blurred by about
 * their own height. The sideways look comes from the shape of the blocks, not
 * from blurring one axis harder — which is what the previews Pete chose from
 * were doing, and it reads better than an anisotropic blur, which leaves the
 * rows still visible as rows.
 */
export const STREAK_ASPECT = 3;
export const STREAK_SIGMA = 1;

/**
 * A streak's height in source pixels.
 *
 * Pete settled on 15px on a preview about 840px wide standing in for a
 * 1920-wide frame, so a source pixel is roughly 2.3 preview pixels: 15 there is
 * about 34 here, which is `width / 56`.
 */
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

/**
 * Block size for a mosaic, in source pixels, scaled to the frame.
 *
 * A fixed size is wrong: 24px blocks that destroy text on a 720p capture leave
 * the same text readable on a 4K one, where the letters are three times the
 * size. `screenshot-redaction.ts` makes the same argument about images.
 */
export function mosaicBlockPx(frameWidth: number | undefined): number {
  const width =
    Number.isFinite(frameWidth) && (frameWidth ?? 0) > 0
      ? (frameWidth as number)
      : 1280;
  return Math.max(16, Math.min(160, Math.round(width / 40)));
}

/** Below this a box is too small to have been meant, and is dropped. */
export const MIN_REDACTION_SIZE = 0.005;
/** A new key within this of an existing one replaces it rather than stacking. */
export const KEY_MERGE_TOLERANCE_MS = 120;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

/** Keep a box inside the frame without changing the corner the user drew from. */
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

/**
 * Read the redactions out of `editsJson.overlays`, dropping anything
 * malformed. The field also carries overlay kinds this version does not know
 * about — text, one day — so unknown kinds are ignored, not discarded:
 * `parseEdits` keeps the raw list, and only this reader filters it.
 */
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

/** Everything in `overlays` that is not a redaction, kept as it was found. */
export function otherOverlays(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item) =>
      !item ||
      typeof item !== "object" ||
      (item as Record<string, unknown>).kind !== "redact",
  );
}

/**
 * Where the box is at a given moment. Before the first key and after the last
 * it holds still — only the stretch between two keys moves, so a box the user
 * never moved never drifts.
 */
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

/** True while the redaction is covering something at this moment. */
export function isRedactionActiveAt(
  redaction: VideoRedaction,
  atMs: number,
): boolean {
  return atMs >= redaction.startMs && atMs < redaction.endMs;
}

/**
 * Put a position on a redaction at a moment. A key close to one already there
 * replaces it — dragging the same box twice at the same spot on the timeline
 * is a correction, not a second waypoint.
 */
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

/**
 * Slide a waypoint along the timeline, keeping the box where it is on screen.
 *
 * This is what adjusts *when* a movement happens — the box still travels
 * between the same two places, but it gets there sooner or later. A waypoint
 * dragged onto another replaces it, the same as placing one there would.
 */
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

/** Drop a waypoint. The last one cannot go — a box has to be somewhere. */
export function removeRedactionKey(
  redaction: VideoRedaction,
  atMs: number,
): VideoRedaction {
  if (redaction.keys.length <= 1) return redaction;
  const keys = redaction.keys.filter((k) => k.atMs !== atMs);
  return keys.length ? { ...redaction, keys } : redaction;
}

/**
 * Move a redaction's time range, keeping its waypoints where they are in the
 * picture. Keys outside the new range still matter — they are what the box
 * interpolates from at the edges — so they are kept, not trimmed.
 */
export function setRedactionRange(
  redaction: VideoRedaction,
  startMs: number,
  endMs: number,
): VideoRedaction {
  const start = Math.max(0, Math.round(Math.min(startMs, endMs)));
  const end = Math.max(start, Math.round(Math.max(startMs, endMs)));
  return { ...redaction, startMs: start, endMs: end };
}

/** The shortest a redaction can be and still be worth drawing. */
export const MIN_REDACTION_MS = 200;

/**
 * Pull a redaction back inside the recording.
 *
 * A range that sits past the end covers nothing — the burn clips to the
 * recording — but worse, it cannot be reached: its bar is drawn off the end of
 * the track, where there is nothing to click, and the box never appears on the
 * picture because it is never active. Rather than leave a redaction the user
 * can neither see nor delete, it is brought back.
 *
 * A range that merely overhangs the end is trimmed, which changes nothing
 * about what it covers. One that is entirely past the end is moved back whole,
 * keeping its length, because there is no part of it worth preserving in place.
 */
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

// ---------------------------------------------------------------------------
// Burning
// ---------------------------------------------------------------------------

/** One stretch between two waypoints, over which the box travels steadily. */
export interface RedactionSegment {
  fromMs: number;
  toMs: number;
  from: RedactionRect;
  to: RedactionRect;
}

/** The smallest rectangle covering both — the size used while travelling. */
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

/**
 * Break a redaction into the stretches between its waypoints, clipped to its
 * own range and to the recording.
 *
 * One stretch per waypoint pair, however long it is: the filters below move
 * the box themselves, so there is nothing to be gained by chopping a movement
 * up — and a great deal to be lost. An earlier version emitted a fixed box
 * every 200ms, which on a fifteen-second clip meant fifty-nine crops and
 * fifty-nine overlays running on every frame: twenty-one seconds of work
 * where the encode alone takes three.
 */
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

/** A filter graph for `-filter_complex`, plus the label to map out of it. */
export interface RedactionFilterGraph {
  filterComplex: string;
  /** What to `-map`. `0:v` when there is nothing to draw. */
  outputLabel: string;
}

/**
 * Edge thickness in source pixels. A single pixel is a single pixel in the
 * *file*, and a file is almost always played smaller than it was recorded — at
 * half size a 1px edge is half a pixel and is not drawn at all.
 */
export function redactionEdgePx(frameWidth: number | undefined): number {
  const width = frameWidth && frameWidth > 0 ? frameWidth : 1280;
  return Math.max(2, Math.min(8, Math.round(width / 480)));
}

/**
 * The mosaic: blocks of the usual size, filled from a random source rather than
 * from the picture.
 *
 * `pixelize` averages the area it covers, so every block is a lossy summary of
 * the thing being hidden and the whole defence rests on the blocks being coarse
 * enough relative to the text. This reads the frame not at all: a grid of wide
 * blocks is generated from the palette, one colour per block chosen by a hash
 * of its own coordinates and the burn's seed, then smeared into bands. There is
 * nothing in the result derived from what it covers, so block size and blur
 * strength are free choices about how it looks.
 *
 * Sizes are absolute because the chain loses sight of the crop's dimensions
 * after the first scale; they come from the frame size the burn probed off the
 * file.
 */
function mosaicChain(
  piece: string,
  destroyed: string,
  size: RedactionRect,
  frameWidth: number,
  frameHeight: number,
  seed: number,
): string {
  // Both dimensions are required, with no fallback. The fill is scaled to a
  // size worked out here rather than from the crop's own `iw`/`ih`, so an
  // under-estimate produces a piece SMALLER than the box and the remainder
  // shows the original picture. A silent default for the height did exactly
  // that on any clip that was not 720 tall.
  if (!(frameWidth > 0) || !(frameHeight > 0)) {
    throw new Error(
      "A redaction needs the frame size to be known before it can be drawn.",
    );
  }
  const boxW = Math.max(1, Math.ceil(frameWidth * size.w));
  const boxH = Math.max(1, Math.ceil(frameHeight * size.h));

  // Wide blocks: the streak comes from their shape.
  const blockH = streakUnitPx(frameWidth);
  const blockW = blockH * STREAK_ASPECT;
  const lowW = Math.max(1, Math.ceil(boxW / blockW));
  const lowH = Math.max(1, Math.ceil(boxH / blockH));
  // Generated at a whole number of blocks — scaling straight to the box makes
  // each block a fractional number of pixels wide and the grid drifts — then
  // cropped back to the box. Without the crop, a box just over one block tall
  // burns at twice its height and swallows the line above or below it.
  const fullW = lowW * blockW;
  const fullH = lowH * blockH;

  // At this resolution one pixel is one block, so X and Y *are* the block's
  // coordinates. The hash turns them into a number that looks random but is
  // the same for all three channels, which is what keeps a block one colour
  // from the palette rather than three unrelated ones. `seed` moves the whole
  // pattern from burn to burn. Nothing here reads the picture.
  const index = `mod(floor(abs(sin((X+1)*12.9898+(Y+1)*78.233+${seed})*43758.5453)),${MOSAIC_PALETTE.length})`;
  const channel = (offset: number) => {
    const values = MOSAIC_PALETTE.map((hex) =>
      parseInt(hex.slice(1 + offset * 2, 3 + offset * 2), 16),
    );
    // Nested `if`s rather than a lookup, which ffmpeg's expressions have no
    // notion of.
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
    // Smeared sideways so the blocks run together into bands. The blur is
    // applied to the generated blocks, never to the picture, so this is still
    // a random field — there is nothing underneath it that a sharpen could
    // bring back.
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

/**
 * One coordinate as an expression: constant when the box holds still, a
 * straight line in `t` when it travels, and clamped so the box can never be
 * asked for at a position that runs off the frame.
 *
 * `dim` is the filter's name for the frame's size (`iw`/`ih` in crop, `W`/`H`
 * in overlay) and `extent` its name for the box's (`out_w`/`out_h`, `w`/`h`).
 */
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

/**
 * Build the graph that burns these redactions in.
 *
 * Each stretch crops the box out of a copy of the picture, destroys what is
 * inside that small piece — averaged into blocks, or filled flat — and lays it
 * back over the frame. The crop and the overlay both follow the box: `crop`
 * re-evaluates x and y every frame and `overlay` does too, so a movement of
 * any length costs one pair of filters however long it lasts.
 *
 * **Work only on the piece, never the whole frame.** Measured on a
 * sixteen-second 1920x1042 clip, against 130s for the encode alone:
 * pixelizing the whole frame and cropping that cost +34s, and painting the
 * whole frame flat to crop a black patch out of it cost **+230s**. Cropping
 * first costs +8s. The area covered is a few percent of the picture; the
 * filters should see a few percent of the pixels.
 *
 * `drawbox` is not used to draw the box itself, for a different reason: it
 * evaluates its geometry once, at filter init, so it cannot move. Here it only
 * ever fills a crop that has already been positioned.
 *
 * The source is split explicitly rather than referenced more than once, which
 * ffmpeg rejects. Every value is a number this module formatted, never text
 * from the user, so nothing in the graph can be read as filter syntax;
 * expressions are single-quoted, which is how ffmpeg's parser is told that the
 * commas inside them belong to the expression.
 */
export function redactionFilterGraph(
  redactions: VideoRedaction[],
  durationMs?: number,
  frameWidth?: number,
  frameHeight?: number,
  /** Changes the mosaic's pattern from one burn to the next. */
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
  // One copy of the picture to draw on, and one to cut each piece out of.
  const sources = ["rbase", ...work.map((_, i) => `rsrc${i}`)];
  parts.push(
    `[0:v]split=${sources.length}${sources.map((l) => `[${l}]`).join("")}`,
  );

  let current = "rbase";
  work.forEach(({ redaction, segment }, index) => {
    // The box is as big as it ever is during this stretch: `crop` sizes itself
    // once, and covering a little more while a box grows is the safe way round.
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
            // The same edge a mosaic gets, for the same reason: redaction
            // black on a dark page is a box nobody can see.
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

/**
 * The most frames a second the burn will write.
 *
 * Browser screen captures come out of `MediaRecorder` with absurd frame rates
 * — one of Pete's sixteen-second clips holds 16,591 frames, a shade over a
 * thousand a second — and every one of them is a frame the filters and the
 * encoder have to handle. Capping at sixty took that burn from 185 seconds to
 * 49 on a two-core box, and nothing a person can see is lost: it is `min`, so
 * a recording already at or below sixty is left exactly as it is.
 */
export const MAX_BURN_FPS = 60;

/**
 * The ffmpeg arguments for the burn.
 *
 * The output is H.264 + AAC in MP4, which is what the export path produces and
 * what plays everywhere. Timestamps are left alone — no fps normalization — so
 * the new file is the same length as the old one and every comment, reaction,
 * chapter and transcript timestamp still lands where it did.
 */
export function redactionBurnFfmpegArgs(input: {
  inputPath: string;
  outputPath: string;
  filterComplex: string;
  outputLabel: string;
}): string[] {
  // The cap goes last, after the boxes: their positions are expressions in
  // `t`, and they should be evaluated against the recording's own clock
  // rather than against a resampled one.
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
