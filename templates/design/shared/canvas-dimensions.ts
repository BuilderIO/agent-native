import {
  MAX_SANE_FRAME_ASPECT_RATIO,
  MAX_SANE_FRAME_DIMENSION_PX,
} from "./responsive-frame-layout.js";

export interface CanvasDimensions {
  width: number;
  height: number;
}

const DIMENSION_PAIR =
  /(?<![\d.,])(-?(?:\d{1,3}(?:,\d{3})+|\d+))\s*(px|pixels?)?\s*(?:x|×|by)\s*(-?(?:\d{1,3}(?:,\d{3})+|\d+))\s*(px|pixels?)?(?!\w)/gi;
const DIMENSION_CONTEXT_BEFORE =
  /\b(?:exact(?:ly)?|fixed[- ]size|dimensions?|size|canvas|artboard|frame|screen|pixels?)\s*(?:(?:to|at)\s*)?(?:[:=]\s*)?$/i;
const DIMENSION_CONTEXT_AFTER =
  /^\s*(?:canvas|artboard|frame|screen|(?:exact(?:ly)?\s+)?(?:dimensions?|size))\b/i;
const FORMAT_CONTEXT_BEFORE =
  /\b(?:ad|advertisement|banner|leaderboard|rectangle|skyscraper|billboard|cover|favicon|logo|avatar|social\s+post|post|story|email\s+header|email|newsletter|print|flyer|poster|screenshot)(?:\s+(?:at|for|of|in|with|size|dimensions?))?\s*$/i;
const FORMAT_CONTEXT_AFTER =
  /^\s*(?:(?:for|as|in)\s+(?:an?\s+)?)?(?:ad|advertisement|banner|leaderboard|rectangle|skyscraper|billboard|cover|favicon|logo|avatar|social\s+post|post|story|email\s+header|email|newsletter|print|flyer|poster|screenshot)\b/i;
const LAYOUT_COUNT_CONTEXT_AFTER =
  /^\s*(?:(?:card\s+)?(?:grid|matrix|layout)|columns?|rows?)\b/i;
const ASPECT_RATIO_CONTEXT_AFTER = /^\s*(?:aspect\s+ratio|ratio)\b/i;
const ASPECT_RATIO_CONTEXT_BEFORE =
  /\b(?:aspect\s+)?ratio\b(?:\s+(?:of|is|to))?\s*[:=]?\s*$/i;
const OUTPUT_LAYOUT_AT_SIZE_CONTEXT_BEFORE =
  /\b(?:card\s+)?(?:grid|matrix|layout)\s+at\s*$/i;
const NON_PIXEL_UNIT_CONTEXT_AFTER =
  /^\s*(?:(?:mm|millimeters?|cm|centimeters?|inch(?:es)?|ft|feet|pt|points?|pc|picas?|em|rem)\b|in\b(?=\s*(?:[.;,!?)]|$))|["″'′])/i;

export function explicitCanvasDimensionsFromPrompt(
  prompt?: string,
): CanvasDimensions | undefined {
  if (!prompt) return undefined;

  const matches = Array.from(prompt.matchAll(DIMENSION_PAIR));
  const explicitDimensionsByKey = new Map<string, CanvasDimensions>();
  const pixelImageDimensionsByKey = new Map<string, CanvasDimensions>();
  const formatDimensionsByKey = new Map<string, CanvasDimensions>();

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!;
    const rawWidth = match[1] ?? "";
    const rawHeight = match[3] ?? "";
    const width = Number(rawWidth.replace(/,/g, ""));
    const height = Number(rawHeight.replace(/,/g, ""));

    const start = match.index ?? 0;
    const end = start + match[0].length;
    const previousEnd =
      index > 0
        ? (matches[index - 1]!.index ?? 0) + matches[index - 1]![0].length
        : 0;
    const nextStart = matches[index + 1]?.index ?? prompt.length;
    const prefixParts = prompt
      .slice(Math.max(previousEnd, start - 48), start)
      .split(/[,;.!?\n]/);
    const prefix = prefixParts[prefixParts.length - 1];
    const suffix = prompt
      .slice(end, Math.min(nextStart, end + 48))
      .split(/[,;.!?\n]/)[0];
    if (
      LAYOUT_COUNT_CONTEXT_AFTER.test(suffix ?? "") ||
      ASPECT_RATIO_CONTEXT_BEFORE.test(prefix ?? "") ||
      ASPECT_RATIO_CONTEXT_AFTER.test(suffix ?? "") ||
      NON_PIXEL_UNIT_CONTEXT_AFTER.test(suffix ?? "")
    ) {
      continue;
    }
    const hasDimensionContext =
      DIMENSION_CONTEXT_BEFORE.test(prefix ?? "") ||
      DIMENSION_CONTEXT_AFTER.test(suffix ?? "") ||
      OUTPUT_LAYOUT_AT_SIZE_CONTEXT_BEFORE.test(prefix ?? "");
    const hasPixelImageContext =
      Boolean(match[2] || match[4]) && /^\s*image\b/i.test(suffix ?? "");
    const hasFormatContext =
      FORMAT_CONTEXT_BEFORE.test(prefix ?? "") ||
      FORMAT_CONTEXT_AFTER.test(suffix ?? "");
    if (!hasDimensionContext && !hasPixelImageContext && !hasFormatContext) {
      continue;
    }

    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width > MAX_SANE_FRAME_DIMENSION_PX ||
      height > MAX_SANE_FRAME_DIMENSION_PX
    ) {
      throw new Error(
        `Exact canvas dimensions ${rawWidth}×${rawHeight} exceed the Design editor limit of ${MAX_SANE_FRAME_DIMENSION_PX} px per dimension. Choose smaller exact dimensions.`,
      );
    }
    if (width <= 0 || height <= 0) {
      throw new Error(
        `Exact canvas dimensions ${rawWidth}×${rawHeight} must be greater than zero. Choose positive exact dimensions.`,
      );
    }
    const aspectRatio = Math.max(width / height, height / width);
    if (aspectRatio > MAX_SANE_FRAME_ASPECT_RATIO) {
      throw new Error(
        `Exact canvas dimensions ${rawWidth}×${rawHeight} exceed the Design editor limit of ${MAX_SANE_FRAME_ASPECT_RATIO}:1. Choose supported exact dimensions.`,
      );
    }

    const target = hasDimensionContext
      ? explicitDimensionsByKey
      : hasPixelImageContext
        ? pixelImageDimensionsByKey
        : formatDimensionsByKey;
    target.set(`${width}x${height}`, { width, height });
  }

  const dimensionsByKey =
    explicitDimensionsByKey.size > 0
      ? explicitDimensionsByKey
      : pixelImageDimensionsByKey.size > 0
        ? pixelImageDimensionsByKey
        : formatDimensionsByKey;
  if (dimensionsByKey.size > 1) {
    const requested = [...dimensionsByKey.values()]
      .map(({ width, height }) => `${width}×${height}`)
      .join(", ");
    throw new Error(
      `Found multiple exact canvas sizes (${requested}). Use one exact canvas size per Design action call, with each prompt scoped to one screen.`,
    );
  }

  return dimensionsByKey.values().next().value;
}
