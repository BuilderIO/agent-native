/**
 * Marks drawn onto a screenshot: boxes, arrows, text and redactions.
 *
 * Everything is described in the image's own pixels, never in screen pixels,
 * so a mark drawn on a scaled-down preview lands in exactly the same place in
 * the stored file. Rendering happens once, at full resolution, when the edit
 * is saved.
 *
 * Sizes scale with the image rather than being fixed: a 3px line that reads
 * clearly on an 800px capture is invisible on a 4K one, and a fixed font size
 * would be unreadable on the same image.
 */

import {
  fillRegion,
  streakRegion,
  streakSeed,
  strokeRedactionEdge,
  type RedactionRect,
  type RedactionStyle,
} from "./screenshot-redaction";
import {
  MARK_COLORS,
  MARK_SHADOW,
  TEXT_OUTLINE_BEHIND_DARK,
  TEXT_OUTLINE_BEHIND_LIGHT,
} from "./tokens/screenshot-colors";
import {
  MIN_REDACTION_SIZE,
  parseRedactions,
  type VideoRedaction,
} from "./video-redactions";

export type AnnotationColor = string;

/** Line weight for boxes and arrows. Thick is twice thin. */
export type MarkThickness = "thin" | "thick";

export interface BoxAnnotation extends RedactionRect {
  kind: "box";
  id: string;
  color: AnnotationColor;
  thickness?: MarkThickness;
  /** Filled solid with its colour, not just outlined. */
  fill?: boolean;
  /** A soft drop shadow, to lift it off a busy picture. */
  shadow?: boolean;
}

export interface RedactAnnotation extends RedactionRect {
  kind: "redact";
  id: string;
  /** Defaults to a mosaic for rows written before solid fill existed. */
  style?: RedactionStyle;
  /**
   * The colour a solid redaction is painted in. Ignored by a mosaic, which
   * keeps the colours of what it destroyed. Defaults to redaction black.
   */
  color?: AnnotationColor;
}

export interface ArrowAnnotation {
  kind: "arrow";
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: AnnotationColor;
  thickness?: MarkThickness;
}

export interface TextAnnotation {
  kind: "text";
  id: string;
  /** Top-left corner of the first line. */
  x: number;
  y: number;
  /** May hold line breaks. */
  text: string;
  color: AnnotationColor;
  /** Font size in the image's own pixels. */
  fontSize?: number;
  /**
   * Multiplier on the image-derived size, from before the size could be set
   * exactly. Only read when `fontSize` is absent.
   */
  scale?: number;
  /**
   * How wide the text box is, in image pixels. Lines wrap to fit it. Absent,
   * the box is as wide as its longest line and only Return breaks a line.
   */
  width?: number;
  font?: TextFontId;
  /** How each line sits in the box. Defaults to left. */
  align?: TextAlign;
}

export type TextAlign = "left" | "center" | "right";

export type TextFontId = "sans" | "serif" | "mono" | "casual" | "impact";

/**
 * Fonts every Mac and Windows machine already has, so what is drawn while
 * editing is what gets saved. The text is flattened into the picture in the
 * editor's own browser, so viewers never need the font.
 */
export const TEXT_FONTS: ReadonlyArray<{
  id: TextFontId;
  label: string;
  family: string;
}> = [
  {
    id: "sans",
    label: "Inter",
    family: '"Inter Variable", Inter, system-ui, sans-serif',
  },
  {
    id: "serif",
    label: "Georgia",
    family: 'Georgia, "Times New Roman", serif',
  },
  {
    id: "mono",
    label: "Courier New",
    family: '"Courier New", Courier, monospace',
  },
  {
    id: "casual",
    label: "Comic Sans",
    family: '"Comic Sans MS", "Chalkboard SE", cursive',
  },
  {
    id: "impact",
    label: "Impact",
    family: 'Impact, "Arial Black", sans-serif',
  },
];

export const DEFAULT_TEXT_FONT: TextFontId = "sans";

export const MIN_TEXT_SIZE = 8;
export const MAX_TEXT_SIZE = 400;

/** Line spacing as a multiple of the font size. */
export const TEXT_LINE_HEIGHT = 1.25;

export type Annotation =
  | BoxAnnotation
  | RedactAnnotation
  | ArrowAnnotation
  | TextAnnotation;

export type AnnotationTool =
  | "select"
  | "crop"
  | "redact"
  | "box"
  | "arrow"
  | "text";

/** Deliberately few: a palette is a decision, not a colour picker. */
export const ANNOTATION_COLORS: readonly AnnotationColor[] = MARK_COLORS;

export const DEFAULT_ANNOTATION_COLOR = ANNOTATION_COLORS[0];

export interface ImageSize {
  width: number;
  height: number;
}

function longestEdge(size: ImageSize): number {
  return Math.max(size.width, size.height);
}

export function annotationLineWidth(size: ImageSize): number {
  return Math.max(2, Math.round(longestEdge(size) / 420));
}

export function annotationFontSize(size: ImageSize, scale = 1): number {
  return Math.max(12, Math.round((longestEdge(size) / 70) * scale));
}

export function arrowHeadLength(size: ImageSize): number {
  return Math.max(10, Math.round(longestEdge(size) / 90));
}

function thicknessFactor(thickness: MarkThickness | undefined): number {
  return thickness === "thick" ? 2 : 1;
}

function drawBox(
  ctx: CanvasRenderingContext2D,
  annotation: BoxAnnotation,
  size: ImageSize,
): void {
  const lineWidth =
    annotationLineWidth(size) * thicknessFactor(annotation.thickness);
  ctx.save();
  if (annotation.shadow) {
    ctx.shadowColor = MARK_SHADOW;
    ctx.shadowBlur = lineWidth * 4;
    ctx.shadowOffsetY = lineWidth;
  }
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = annotation.color;
  ctx.fillStyle = annotation.color;
  ctx.lineJoin = "round";
  if (annotation.fill) {
    ctx.fillRect(
      annotation.x,
      annotation.y,
      annotation.width,
      annotation.height,
    );
  }
  ctx.strokeRect(
    annotation.x,
    annotation.y,
    annotation.width,
    annotation.height,
  );
  ctx.restore();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  annotation: ArrowAnnotation,
  size: ImageSize,
): void {
  const factor = thicknessFactor(annotation.thickness);
  const lineWidth = annotationLineWidth(size) * factor;
  const head = arrowHeadLength(size) * (factor === 1 ? 1 : 1.5);
  const angle = Math.atan2(
    annotation.toY - annotation.fromY,
    annotation.toX - annotation.fromX,
  );

  ctx.save();
  ctx.strokeStyle = annotation.color;
  ctx.fillStyle = annotation.color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";

  // Stop the shaft short of the tip so the head is a point, not a blob.
  ctx.beginPath();
  ctx.moveTo(annotation.fromX, annotation.fromY);
  ctx.lineTo(
    annotation.toX - Math.cos(angle) * head * 0.6,
    annotation.toY - Math.sin(angle) * head * 0.6,
  );
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(annotation.toX, annotation.toY);
  ctx.lineTo(
    annotation.toX - Math.cos(angle - Math.PI / 7) * head,
    annotation.toY - Math.sin(angle - Math.PI / 7) * head,
  );
  ctx.lineTo(
    annotation.toX - Math.cos(angle + Math.PI / 7) * head,
    annotation.toY - Math.sin(angle + Math.PI / 7) * head,
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function textFontSize(
  annotation: TextAnnotation,
  size: ImageSize,
): number {
  return annotation.fontSize ?? annotationFontSize(size, annotation.scale ?? 1);
}

export function textFontFamily(font: TextFontId | undefined): string {
  return (TEXT_FONTS.find((entry) => entry.id === font) ?? TEXT_FONTS[0])
    .family;
}

/** The canvas `font` shorthand for a text mark at a given pixel size. */
export function textFontCss(font: TextFontId | undefined, px: number): string {
  return `600 ${px}px ${textFontFamily(font)}`;
}

export type MeasureText = (line: string) => number;

/**
 * Split text into the lines it is drawn as: at every Return, and — when the
 * box has a width — wherever the next word would not fit. A word longer than
 * the whole box is broken mid-word rather than left sticking out of it.
 */
export function wrapTextLines(
  text: string,
  maxWidth: number | undefined,
  measure: MeasureText,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!maxWidth || measure(paragraph) <= maxWidth) {
      lines.push(paragraph);
      continue;
    }
    let line = "";
    for (const word of paragraph.split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      let rest = word;
      while (rest && measure(rest) > maxWidth) {
        let cut = 1;
        while (
          cut < rest.length &&
          measure(rest.slice(0, cut + 1)) <= maxWidth
        ) {
          cut++;
        }
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

let measuringContext: CanvasRenderingContext2D | null | undefined;

/**
 * Measure with a real canvas when there is one. Without a DOM — on the server,
 * in unit tests — fall back to an average character width, which is close
 * enough for clicking on a mark.
 */
function measurerFor(font: TextFontId | undefined, px: number): MeasureText {
  if (measuringContext === undefined) {
    measuringContext =
      typeof document === "undefined"
        ? null
        : document.createElement("canvas").getContext("2d");
  }
  const ctx = measuringContext;
  if (!ctx) return (line) => line.length * px * 0.55;
  return (line) => {
    ctx.font = textFontCss(font, px);
    return ctx.measureText(line).width;
  };
}

export interface TextLayout {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  /** The box: the set width, or the longest line when there is none. */
  width: number;
  height: number;
}

export function layoutText(
  annotation: TextAnnotation,
  size: ImageSize,
  measure?: MeasureText,
): TextLayout {
  const fontSize = textFontSize(annotation, size);
  const measureLine = measure ?? measurerFor(annotation.font, fontSize);
  const lines = wrapTextLines(annotation.text, annotation.width, measureLine);
  const lineHeight = fontSize * TEXT_LINE_HEIGHT;
  const longest = Math.max(0, ...lines.map(measureLine));
  return {
    lines,
    fontSize,
    lineHeight,
    width: annotation.width ?? Math.max(fontSize, longest),
    height: Math.max(1, lines.length) * lineHeight,
  };
}

/** Whether a #rrggbb colour is dark enough to need a light outline. */
export function isDarkColor(hex: string): boolean {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return false;
  const [r, g, b] = match.slice(1).map((part) => parseInt(part, 16));
  // Perceived brightness, weighted the way the eye weights the channels.
  return 0.299 * r + 0.587 * g + 0.114 * b < 96;
}

/** How far in from the box's left edge a line starts. */
export function textLineOffset(
  align: TextAlign | undefined,
  boxWidth: number,
  lineWidth: number,
): number {
  if (align === "center") return (boxWidth - lineWidth) / 2;
  if (align === "right") return boxWidth - lineWidth;
  return 0;
}

function drawText(
  ctx: CanvasRenderingContext2D,
  annotation: TextAnnotation,
  size: ImageSize,
): void {
  const fontSize = textFontSize(annotation, size);
  ctx.save();
  ctx.font = textFontCss(annotation.font, fontSize);
  ctx.textBaseline = "alphabetic";
  const layout = layoutText(
    annotation,
    size,
    (line) => ctx.measureText(line).width,
  );
  // An outline behind the fill keeps text readable on any screenshot without
  // a background plate covering the picture: dark behind light text, light
  // behind dark text, so black stays visible on a dark window.
  ctx.lineWidth = Math.max(2, Math.round(fontSize / 6));
  ctx.strokeStyle = isDarkColor(annotation.color)
    ? TEXT_OUTLINE_BEHIND_DARK
    : TEXT_OUTLINE_BEHIND_LIGHT;
  ctx.lineJoin = "round";
  ctx.fillStyle = annotation.color;
  // Place each baseline the way CSS does — half the spare line height above
  // the font's own ascent and descent — so the saved text sits exactly where
  // it was typed in the editing box, whatever the font.
  const metrics = ctx.measureText("Hg");
  const ascent = metrics.fontBoundingBoxAscent ?? fontSize * 0.8;
  const descent = metrics.fontBoundingBoxDescent ?? fontSize * 0.2;
  const baseline = (layout.lineHeight - (ascent + descent)) / 2 + ascent;
  layout.lines.forEach((line, index) => {
    const y = annotation.y + baseline + index * layout.lineHeight;
    const x =
      annotation.x +
      textLineOffset(
        annotation.align,
        layout.width,
        ctx.measureText(line).width,
      );
    ctx.strokeText(line, x, y);
    ctx.fillText(line, x, y);
  });
  ctx.restore();
}

/**
 * The smallest a redaction may be along each side, in image pixels.
 *
 * The stored form (`parseRedactions`) drops anything under
 * `MIN_REDACTION_SIZE` of the picture as a slip of the mouse. On a 4K capture
 * that is about 20px — the width of a short password — so a box drawn or
 * shrunk below it has to be grown to it, not thrown away, or the hold on the
 * screenshot lifts while the content is still showing in the original. One
 * pixel over, so rounding can never land it back under the line.
 */
export function minRedactionSide(length: number): number {
  return Math.min(length, Math.ceil(length * MIN_REDACTION_SIZE) + 1);
}

/**
 * A redaction as it will be stored: whole pixels, inside the picture, and at
 * least the minimum size.
 *
 * The part of a box dragged past an edge covers nothing, so it is cut off
 * rather than the box being shifted — shifting would uncover what it was
 * placed over. A box too small is grown about its centre. Every path that
 * draws, stores or burns a redaction goes through this, so what the editor
 * shows is exactly what is saved.
 */
export function fitRedaction<T extends RedactionRect>(
  region: T,
  size: ImageSize,
): T {
  if (!size.width || !size.height) return region;
  const fitAxis = (start: number, length: number, total: number) => {
    let from = Math.max(0, Math.floor(Math.min(start, start + length)));
    let to = Math.min(total, Math.ceil(Math.max(start, start + length)));
    if (to < from) to = from;
    const min = minRedactionSide(total);
    if (to - from < min) {
      const centre = (from + to) / 2;
      from = Math.round(Math.min(Math.max(centre - min / 2, 0), total - min));
      to = from + min;
    }
    return { from, length: to - from };
  };
  const x = fitAxis(region.x, region.width, size.width);
  const y = fitAxis(region.y, region.height, size.height);
  return { ...region, x: x.from, y: y.from, width: x.length, height: y.length };
}

/**
 * Keep a redaction being dragged wholly inside the picture, the same size.
 * Unlike `fitRedaction` this moves the box: during a drag it is the pointer
 * that went too far, not the box that is too big.
 */
export function keepRedactionInside<T extends RedactionRect>(
  region: T,
  size: ImageSize,
): T {
  if (!size.width || !size.height) return region;
  return {
    ...region,
    x: Math.min(Math.max(region.x, 0), Math.max(0, size.width - region.width)),
    y: Math.min(
      Math.max(region.y, 0),
      Math.max(0, size.height - region.height),
    ),
  };
}

/**
 * The picture with only its redactions drawn, the way the video burn draws
 * them: grey streaks or a solid fill, each with its own border.
 */
export function renderRedactedBase(
  source: CanvasImageSource,
  size: ImageSize,
  annotations: readonly Annotation[],
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser could not edit the image.");
  ctx.drawImage(source, 0, 0, size.width, size.height);
  const redactions = annotations
    .filter(
      (annotation): annotation is RedactAnnotation =>
        annotation.kind === "redact",
    )
    .map((region) => fitRedaction(region, size));
  for (const region of redactions) {
    if (region.style === "solid") fillRegion(canvas, region, region.color);
    else streakRegion(canvas, region, streakSeed(region.id));
    strokeRedactionEdge(canvas, region);
  }
  return canvas;
}

/**
 * Draw the image with every mark applied, in the order they were made, at
 * full resolution. The result is what gets stored: marks are part of the
 * picture, not an overlay that a viewer could strip off.
 */
export function renderAnnotated(
  source: CanvasImageSource,
  size: ImageSize,
  annotations: readonly Annotation[],
  /**
   * `renderRedactedBase` of this picture and these redactions, when the
   * caller already has it. The streaked redactions are the slow part of a
   * render, and dragging an arrow or a box does not change them.
   */
  redactedBase?: HTMLCanvasElement,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser could not edit the image.");
  ctx.drawImage(
    redactedBase ?? renderRedactedBase(source, size, annotations),
    0,
    0,
  );

  // Then the marks, which sit on top — a label or an arrow pointing at a
  // redacted area should not be buried under the mosaic.
  for (const annotation of annotations) {
    switch (annotation.kind) {
      case "box":
        drawBox(ctx, annotation, size);
        break;
      case "arrow":
        drawArrow(ctx, annotation, size);
        break;
      case "text":
        if (annotation.text.trim()) drawText(ctx, annotation, size);
        break;
      case "redact":
        break;
    }
  }

  return canvas;
}

export function redactionsOf(
  annotations: readonly Annotation[],
  size: ImageSize,
): RedactionRect[] {
  return annotations
    .filter((a): a is RedactAnnotation => a.kind === "redact")
    .map((region) => fitRedaction(region, size))
    .map(({ x, y, width, height }) => ({ x, y, width, height }));
}

/**
 * The box a mark occupies, used for hit-testing and for drawing handles.
 * Text is measured on a canvas in the browser and estimated elsewhere.
 */
export function annotationBounds(
  annotation: Annotation,
  size: ImageSize,
): RedactionRect {
  switch (annotation.kind) {
    case "box":
    case "redact":
      return {
        x: annotation.x,
        y: annotation.y,
        width: annotation.width,
        height: annotation.height,
      };
    case "arrow":
      return {
        x: Math.min(annotation.fromX, annotation.toX),
        y: Math.min(annotation.fromY, annotation.toY),
        width: Math.abs(annotation.toX - annotation.fromX),
        height: Math.abs(annotation.toY - annotation.fromY),
      };
    case "text": {
      const layout = layoutText(annotation, size);
      return {
        x: annotation.x,
        y: annotation.y,
        width: layout.width,
        height: layout.height,
      };
    }
  }
}

/**
 * The topmost mark under a point, or null.
 *
 * Later marks are drawn on top, so they are tested first — clicking where two
 * overlap picks the one you can see. Redactions are drawn underneath every
 * mark, so they are tested last. Only redactions not yet burned in are in the
 * list at all; a burned one is part of the picture.
 */
export function hitTestAnnotation(
  annotations: readonly Annotation[],
  point: { x: number; y: number },
  size: ImageSize,
  tolerance = 0,
): Annotation | null {
  const ordered = [
    ...annotations.filter((annotation) => annotation.kind === "redact"),
    ...annotations.filter((annotation) => annotation.kind !== "redact"),
  ];
  for (let index = ordered.length - 1; index >= 0; index--) {
    const annotation = ordered[index];
    const bounds = annotationBounds(annotation, size);
    if (
      point.x >= bounds.x - tolerance &&
      point.x <= bounds.x + bounds.width + tolerance &&
      point.y >= bounds.y - tolerance &&
      point.y <= bounds.y + bounds.height + tolerance
    ) {
      return annotation;
    }
  }
  return null;
}

/** Move a mark by a delta in image pixels. */
export function moveAnnotation(
  annotation: Annotation,
  dx: number,
  dy: number,
): Annotation {
  switch (annotation.kind) {
    case "box":
    case "redact":
      return { ...annotation, x: annotation.x + dx, y: annotation.y + dy };
    case "arrow":
      return {
        ...annotation,
        fromX: annotation.fromX + dx,
        fromY: annotation.fromY + dy,
        toX: annotation.toX + dx,
        toY: annotation.toY + dy,
      };
    case "text":
      return { ...annotation, x: annotation.x + dx, y: annotation.y + dy };
  }
}

export type ResizeHandle = "start" | "end";

/**
 * Drag one end of a mark. A box is resized from the corner opposite the one
 * being dragged; an arrow just moves the end being held; text only changes
 * width, from the side being dragged, and rewraps to fit.
 */
export function resizeAnnotation(
  annotation: Annotation,
  handle: ResizeHandle,
  point: { x: number; y: number },
  size?: ImageSize,
): Annotation {
  if (annotation.kind === "text") {
    const fontSize = size
      ? textFontSize(annotation, size)
      : (annotation.fontSize ?? 16);
    const minWidth = fontSize * 2;
    const width =
      annotation.width ??
      (size ? layoutText(annotation, size).width : minWidth);
    if (handle === "end") {
      return {
        ...annotation,
        width: Math.round(Math.max(minWidth, point.x - annotation.x)),
      };
    }
    const right = annotation.x + width;
    const x = Math.min(point.x, right - minWidth);
    return { ...annotation, x: Math.round(x), width: Math.round(right - x) };
  }
  if (annotation.kind === "arrow") {
    return handle === "start"
      ? { ...annotation, fromX: point.x, fromY: point.y }
      : { ...annotation, toX: point.x, toY: point.y };
  }
  if (annotation.kind === "box" || annotation.kind === "redact") {
    const anchorX =
      handle === "start" ? annotation.x + annotation.width : annotation.x;
    const anchorY =
      handle === "start" ? annotation.y + annotation.height : annotation.y;
    return {
      ...annotation,
      x: Math.min(anchorX, point.x),
      y: Math.min(anchorY, point.y),
      width: Math.abs(point.x - anchorX),
      height: Math.abs(point.y - anchorY),
    };
  }
  return annotation;
}

/**
 * Where the two drag handles for a mark belong, in image pixels.
 *
 * A box is dragged by opposite corners of its bounds, but an arrow is not a
 * rectangle: it runs between two points, and its bounds only touch those
 * points at two of the four corners. Putting the handles on the bounding box
 * therefore hands the user the wrong end of an arrow drawn up-and-right or
 * down-and-left — grabbing the tip moves the tail and the arrow flips. The
 * handles have to follow the mark's own geometry, which is what this returns.
 *
 * `start` and `end` are the handles `resizeAnnotation` expects. Text gets one
 * on each side, halfway down, because dragging only sets its width. A
 * redaction is sized like a box.
 */
export function annotationHandlePoints(
  annotation: Annotation,
  size: ImageSize,
): { start: { x: number; y: number }; end: { x: number; y: number } } | null {
  if (annotation.kind === "arrow") {
    return {
      start: { x: annotation.fromX, y: annotation.fromY },
      end: { x: annotation.toX, y: annotation.toY },
    };
  }
  if (annotation.kind === "box" || annotation.kind === "redact") {
    const bounds = annotationBounds(annotation, size);
    return {
      start: { x: bounds.x, y: bounds.y },
      end: { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    };
  }
  if (annotation.kind === "text") {
    const bounds = annotationBounds(annotation, size);
    const middle = bounds.y + bounds.height / 2;
    return {
      start: { x: bounds.x, y: middle },
      end: { x: bounds.x + bounds.width, y: middle },
    };
  }
  return null;
}

/** Marks the editor keeps as data, in draw order. */
export function movableAnnotations(
  annotations: readonly Annotation[],
): Annotation[] {
  return annotations.filter((annotation) => annotation.kind !== "redact");
}

/**
 * Redactions not yet burned in, in the form the video editor stores them.
 *
 * They go in `editsJson.overlays` exactly as a clip's do, because everything
 * that keeps a half-redacted clip away from viewers — the media routes, the
 * share link, the share dialog, the library — already reads that list. A
 * screenshot has no timeline, so each is one fixed position with a nominal
 * time range; `parseRedactions` needs a range that is not empty.
 */
export function toPendingOverlays(
  annotations: readonly Annotation[],
  size: ImageSize,
): VideoRedaction[] {
  if (!size.width || !size.height) return [];
  return annotations
    .filter((a): a is RedactAnnotation => a.kind === "redact")
    .map((region) => fitRedaction(region, size))
    .map((region) => ({
      id: region.id,
      kind: "redact" as const,
      style: region.style ?? "mosaic",
      ...(region.style === "solid" && region.color
        ? { color: region.color }
        : {}),
      startMs: 0,
      endMs: 1,
      keys: [
        {
          atMs: 0,
          x: region.x / size.width,
          y: region.y / size.height,
          w: region.width / size.width,
          h: region.height / size.height,
        },
      ],
    }));
}

/** The pending redactions stored on a screenshot, back in image pixels. */
export function fromPendingOverlays(
  overlays: unknown,
  size: ImageSize,
): RedactAnnotation[] {
  if (!size.width || !size.height) return [];
  return parseRedactions(overlays).map((redaction) => {
    const key = redaction.keys[0];
    return {
      kind: "redact",
      id: redaction.id,
      style: redaction.style,
      ...(redaction.color ? { color: redaction.color } : {}),
      x: Math.round(key.x * size.width),
      y: Math.round(key.y * size.height),
      width: Math.round(key.w * size.width),
      height: Math.round(key.h * size.height),
    };
  });
}

/**
 * The part of a picture that is shown, in image pixels. Cropping is kept as
 * data over the full picture, like the marks, so a crop can be widened again
 * later; only the copy served to viewers is cut down.
 */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A crop read back from `editsJson`, or null when it is missing or unusable. */
export function parseCrop(raw: unknown, size: ImageSize): CropRect | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const nums = [r.x, r.y, r.width, r.height];
  if (nums.some((n) => typeof n !== "number" || !Number.isFinite(n)))
    return null;
  const x = Math.max(0, Math.round(r.x as number));
  const y = Math.max(0, Math.round(r.y as number));
  const width = Math.min(Math.round(r.width as number), size.width - x);
  const height = Math.min(Math.round(r.height as number), size.height - y);
  if (width < 1 || height < 1) return null;
  // A crop of the whole picture is no crop.
  if (x === 0 && y === 0 && width === size.width && height === size.height) {
    return null;
  }
  return { x, y, width, height };
}

/** A copy of just the cropped part of a canvas. */
export function cropCanvas(
  source: HTMLCanvasElement,
  crop: CropRect,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = crop.width;
  canvas.height = crop.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser could not edit the image.");
  ctx.drawImage(source, -crop.x, -crop.y);
  return canvas;
}

/** A copy of a mark, nudged down and right so it is visibly a second one. */
export function duplicateAnnotation(
  annotation: Annotation,
  size: ImageSize,
): Annotation {
  const nudge = Math.max(8, Math.round(Math.max(size.width, size.height) / 60));
  return { ...moveAnnotation(annotation, nudge, nudge), id: newAnnotationId() };
}

export function newAnnotationId(): string {
  return Math.random().toString(36).slice(2, 10);
}
