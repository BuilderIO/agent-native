import { MAX_FIG_FRAME_HTML_BYTES } from "@shared/import-limits";
import type { ZodError } from "zod";

/**
 * The one shape every design-tool adapter produces and the one emitter reads.
 * Adapters own their format's quirks (units, colors, token indirection); the
 * emitter owns HTML, escaping and safety. Colors are CSS hex by this point.
 */

/** Bounds enforced on an untrusted copy before any large or recursive work. */
export const PASTE_LIMITS = {
  /** Characters of encoded clipboard data a copy may carry. */
  encodedChars: 32 * 1024 * 1024,
  nodes: 50_000,
  depth: 200,
  frames: 50,
  /**
   * Emitted HTML per frame. Under the import action's limit by a margin for
   * the document wrapper, font links and the server's own annotations.
   */
  frameBytes: MAX_FIG_FRAME_HTML_BYTES - 256 * 1024,
  /** Emitted HTML across all frames of one paste. */
  totalBytes: 16 * 1024 * 1024,
  /** Remote images hosted for one paste; the rest keep their link. */
  hostedImages: 40,
  /** Distinct font families a frame may ask for, and the longest name. */
  fontFamilies: 8,
  fontFamilyChars: 80,
  /** Style properties read from one layer. */
  styleProperties: 200,
  /** Image fills one layer may carry, and fills of any kind a copy may list. */
  imageFills: 8,
  fillsPerLayer: 64,
  shadowsPerLayer: 32,
  /** Columns in one grid definition, and how deeply a track may nest. */
  gridTracks: 64,
  gridTrackDepth: 4,
  /** Characters kept of a layer's name. */
  labelChars: 200,
} as const;

/**
 * Something a converter could not carry over. Structured so the editor can
 * localize it; `detail` and `reason` are technical text for the console only.
 */
export type PasteWarning =
  | { kind: "inexact"; detail: string }
  | { kind: "layer-type"; type: string }
  | { kind: "image-placeholders"; count: number }
  | { kind: "images-linked"; count: number; reason: string | null }
  | { kind: "images-unsaved"; count: number };

export type PasteWarnings = PasteWarning[];

/** Warnings kept for one paste; a crafted copy cannot grow the list without bound. */
const MAX_WARNINGS = 200;

export function pushWarning(
  warnings: PasteWarnings,
  warning: PasteWarning,
): void {
  if (warnings.length < MAX_WARNINGS) {
    warnings.push(warning);
  } else if (warnings.length === MAX_WARNINGS) {
    warnings.push(inexact("More problems were found than are listed."));
  }
}

export function inexact(detail: string): PasteWarning {
  return { kind: "inexact", detail };
}

export function uniqueWarnings(warnings: PasteWarnings): PasteWarnings {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = JSON.stringify(warning);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** camelCase CSS property to value; names and values are validated at emit. */
export type PasteStyle = Record<string, string | number>;

export interface PasteFont {
  family: string;
  fallback?: string | undefined;
}

export interface PasteImage {
  url: string;
  size?: string | undefined;
  position?: string | undefined;
  repeat?: string | undefined;
}

export interface PasteBox {
  kind: "box";
  label: string;
  tag?: string | undefined;
  style: PasteStyle;
  font?: PasteFont | undefined;
  images?: PasteImage[] | undefined;
  children: PasteNode[];
}

export interface PasteText {
  kind: "text";
  label: string;
  tag?: string | undefined;
  style: PasteStyle;
  font?: PasteFont | undefined;
  text: string;
}

export interface PasteSvg {
  kind: "svg";
  label: string;
  attrs: Record<string, string>;
  style: PasteStyle;
  children: PasteNode[];
}

export interface PasteShape {
  kind: "shape";
  tag: string;
  attrs: Record<string, string>;
}

export type PasteNode = PasteBox | PasteText | PasteSvg | PasteShape;

export interface PasteFrame {
  title: string;
  root: PasteNode;
  /** Layout size as the source states it ("1280", "800px", or absent). */
  width: unknown;
  height: unknown;
  /** The frame's spot on the source canvas, used to place it. */
  origin: { x: number; y: number } | null;
}

export function hexColor(
  r: number,
  g: number,
  b: number,
  alpha: number = 1,
): string {
  const byte = (channel: number) =>
    Math.round(Math.min(255, Math.max(0, channel)))
      .toString(16)
      .padStart(2, "0");
  const hex = `#${byte(r)}${byte(g)}${byte(b)}`;
  return alpha >= 1 ? hex : `${hex}${byte(Math.max(0, alpha) * 255)}`;
}

/** The first schema failure, in words a person can act on. */
export function firstIssue(error: ZodError): string {
  const issue = [...error.issues].shift();
  if (!issue) return "the clipboard data is not in the expected shape";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

/**
 * A record read that is honest about absence and ignores inherited keys, so a
 * payload naming "constructor" or "__proto__" finds nothing.
 */
export function lookup<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}
