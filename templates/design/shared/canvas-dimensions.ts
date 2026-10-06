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
  /\b(?:ad|advertisement|banner|leaderboard|rectangle|skyscraper|billboard|cover|favicon|logo|avatar|social\s+post|post|story|email\s+header|email|newsletter|print|flyer|poster|screenshot)(?:\s+(?:at|for|of|in|with|size|dimensions?))?\s*[:,;]?\s*$/i;
const FORMAT_CONTEXT_AFTER =
  /^\s*(?:(?:for|as|in)\s+(?:an?\s+)?)?(?:ad|advertisement|banner|leaderboard|rectangle|skyscraper|billboard|cover|favicon|logo|avatar|social\s+post|post|story|email\s+header|email|newsletter|print|flyer|poster|screenshot)\b/i;
const LAYOUT_COUNT_CONTEXT_AFTER =
  /^\s*(?:(?:card\s+)?(?:grid|matrix|layout)|columns?|rows?)\b/i;
const ASPECT_RATIO_CONTEXT_AFTER = /^\s*(?:aspect\s+ratio|ratio)\b/i;
const ASPECT_RATIO_CONTEXT_BEFORE =
  /\b(?:aspect\s+)?ratio\b(?:\s+(?:of|is|to))?\s*[:=]?\s*$/i;
const OUTPUT_LAYOUT_AT_SIZE_CONTEXT_BEFORE =
  /\b(?:card\s+)?(?:grid|matrix|layout)\s+at\s*$/i;
const IMAGE_OUTPUT_CONTEXT_BEFORE =
  /\bimage\s+(?:(?:at|of)\s*|with\s+(?:exact(?:ly)?\s+)?(?:dimensions?|size)\s*)?$/i;
const ASSET_CONTEXT_AFTER =
  /^\s*(?:(?:hero|background|header|main|featured|product|profile|thumbnail|preview)\s+)*(?:image|asset|icon|logo|favicon|avatar|illustration)\b/i;
const OUTPUT_CONTAINER_CONTEXT =
  "(?:screen|canvas|artboard|frame|(?:responsive\\s+)?(?:landing\\s+)?page|web\\s+app|website|web\\s+site|dashboard|ad|advertisement|banner|leaderboard|rectangle|skyscraper|billboard|cover|social\\s+post|post|story|email\\s+header|email|newsletter|print|flyer|poster|screenshot)";
const NESTED_OUTPUT_ASSET_AFTER =
  /^\s*(?:(?:hero|background|header|main|featured|product|profile|thumbnail|preview)\s+)*(?:image|asset|icon|logo|favicon|avatar|illustration|ad|advertisement|banner|leaderboard|rectangle|skyscraper|billboard)\b/i;
const NESTED_OUTPUT_RELATIONSHIP_BEFORE = new RegExp(
  `\\b${OUTPUT_CONTAINER_CONTEXT}\\b[\\s\\S]{0,48}(?:\\b(?:with|including|containing|inside|featuring)\\s+(?:an?|the)?\\s*|\\b(?:that|which)\\s+(?:includes|contains|features|has)\\s+(?:an?|the)?\\s*|[.!?;,]\\s*(?:add|insert|place|put|include|use)\\s+(?:an?|the)?\\s*)$`,
  "i",
);
const NESTED_OUTPUT_ASSET_CONTEXT_BEFORE = new RegExp(
  `\\b${OUTPUT_CONTAINER_CONTEXT}\\b[\\s\\S]{0,48}\\b(?:with|including|containing|inside|featuring|(?:that|which)\\s+(?:includes|contains|features|has))\\s+(?:an?|the)?\\s*(?:(?:embedded|nested|hero|background|header|main|featured|product|profile|thumbnail|preview)\\s+)*(?:image|asset|icon|logo|favicon|avatar|illustration|ad|advertisement|banner|leaderboard|rectangle|skyscraper|billboard)\\s+(?:(?:with\\s+)?(?:exact(?:ly)?\\s+)?(?:dimensions?|size)(?:\\s+(?:of|is|at|to))?|at|exact(?:ly)?)?\\s*$`,
  "i",
);
const NON_PIXEL_UNIT_CONTEXT_AFTER =
  /^\s*(?:(?:mm|millimeters?|cm|centimeters?|inch(?:es)?|ft|feet|pt|points?|pc|picas?|em|rem)\b|in\b(?=\s*(?:[.;,!?)]|$))|["″'′])/i;

interface CanvasDimensionCandidate {
  rawWidth: string;
  rawHeight: string;
  width: number;
  height: number;
}

export function explicitCanvasDimensionsFromPrompt(
  prompt?: string,
): CanvasDimensions | undefined {
  if (!prompt) return undefined;

  const matches = Array.from(prompt.matchAll(DIMENSION_PAIR));
  const explicitDimensionsByKey = new Map<string, CanvasDimensionCandidate>();
  const formatDimensionsByKey = new Map<string, CanvasDimensionCandidate>();
  const imageDimensionsByKey = new Map<string, CanvasDimensionCandidate>();
  const outputDimensionsByKey = new Map<string, CanvasDimensionCandidate>();

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
    const nearbyPrefix = prompt.slice(Math.max(0, start - 96), start);
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
      Boolean(match[2] || match[4]) && ASSET_CONTEXT_AFTER.test(suffix ?? "");
    const hasFormatContext =
      FORMAT_CONTEXT_BEFORE.test(prefix ?? "") ||
      FORMAT_CONTEXT_BEFORE.test(nearbyPrefix) ||
      FORMAT_CONTEXT_AFTER.test(suffix ?? "");
    const hasNestedAssetContext =
      NESTED_OUTPUT_ASSET_CONTEXT_BEFORE.test(nearbyPrefix) ||
      (NESTED_OUTPUT_RELATIONSHIP_BEFORE.test(nearbyPrefix) &&
        NESTED_OUTPUT_ASSET_AFTER.test(suffix ?? ""));
    const hasImageOutputContext =
      IMAGE_OUTPUT_CONTEXT_BEFORE.test(prefix ?? "") ||
      (ASSET_CONTEXT_AFTER.test(suffix ?? "") &&
        (Boolean(match[2] || match[4]) || (width >= 100 && height >= 100)));

    if (hasNestedAssetContext) continue;
    if (
      !hasDimensionContext &&
      !hasImageOutputContext &&
      !hasPixelImageContext &&
      !hasFormatContext
    ) {
      continue;
    }

    const candidate = { rawWidth, rawHeight, width, height };
    const target = hasDimensionContext
      ? explicitDimensionsByKey
      : hasFormatContext && !hasImageOutputContext
        ? formatDimensionsByKey
        : imageDimensionsByKey;
    const key = `${width}x${height}`;
    target.set(key, candidate);
    outputDimensionsByKey.set(key, candidate);
  }

  const dimensionsByKey =
    explicitDimensionsByKey.size > 0
      ? explicitDimensionsByKey
      : formatDimensionsByKey.size > 0
        ? formatDimensionsByKey
        : imageDimensionsByKey;
  for (const candidate of outputDimensionsByKey.values()) {
    const { rawWidth, rawHeight, width, height } = candidate;
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
  }
  if (outputDimensionsByKey.size > 1) {
    const requested = [...outputDimensionsByKey.values()]
      .map(({ width, height }) => `${width}×${height}`)
      .join(", ");
    throw new Error(
      `Found multiple exact canvas sizes (${requested}). Use one exact canvas size per Design action call, with each prompt scoped to one screen.`,
    );
  }

  const selected = dimensionsByKey.values().next().value;
  return selected
    ? { width: selected.width, height: selected.height }
    : undefined;
}
