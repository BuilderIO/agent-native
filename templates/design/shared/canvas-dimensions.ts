export interface CanvasDimensions {
  width: number;
  height: number;
}

const DIMENSION_PAIR =
  /(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d{1,5})\s*(px\b)?\s*(?:x|×|by)\s*(\d{1,3}(?:,\d{3})+|\d{1,5})\s*(px|pixels?)?(?!\w)/gi;
const DIMENSION_CONTEXT_BEFORE =
  /\b(?:exact(?:ly)?|fixed[- ]size|dimensions?|size|canvas|artboard|frame|screen|pixels?)\s*(?:[:=]\s*)?$/i;
const DIMENSION_CONTEXT_AFTER =
  /^\s*(?:canvas|artboard|frame|screen|(?:exact(?:ly)?\s+)?(?:dimensions?|size))\b/i;
const FORMAT_CONTEXT_BEFORE =
  /\b(?:ad|advertisement|banner|leaderboard|rectangle|skyscraper|billboard|cover|favicon|logo|avatar|social\s+post|post|story|email|newsletter|print|flyer|poster|screenshot)(?:\s+(?:at|for|of|in|with|size|dimensions?))?\s*$/i;
const FORMAT_CONTEXT_AFTER =
  /^\s*(?:(?:for|as|in)\s+(?:an?\s+)?)?(?:ad|advertisement|banner|leaderboard|rectangle|skyscraper|billboard|cover|favicon|logo|avatar|social\s+post|post|story|email|newsletter|print|flyer|poster|screenshot)\b/i;
const SMALL_FORMAT_CONTEXT_BEFORE =
  /\b(?:icon|favicon|logo|avatar)(?:\s+(?:at|for|of|in|with|size|dimensions?))?\s*$/i;
const SMALL_FORMAT_CONTEXT_AFTER =
  /^\s*(?:(?:for|as|in)\s+(?:an?\s+)?)?(?:icon|favicon|logo|avatar)\b/i;
const LAYOUT_COUNT_CONTEXT_AFTER =
  /^\s*(?:(?:card\s+)?(?:grid|matrix|layout)|columns?|rows?)\b/i;
const ASPECT_RATIO_CONTEXT_AFTER = /^\s*(?:aspect\s+ratio|ratio)\b/i;
const ASPECT_RATIO_CONTEXT_BEFORE =
  /\b(?:aspect\s+)?ratio\b(?:\s+(?:of|is|to))?\s*[:=]?\s*$/i;

export function explicitCanvasDimensionsFromPrompt(
  prompt?: string,
): CanvasDimensions | undefined {
  if (!prompt) return undefined;

  const matches = Array.from(prompt.matchAll(DIMENSION_PAIR));
  const dimensionsByKey = new Map<string, CanvasDimensions>();

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!;
    const width = Number(match[1]?.replace(/,/g, ""));
    const height = Number(match[3]?.replace(/,/g, ""));
    if (!Number.isFinite(width) || !Number.isFinite(height)) continue;
    if (width <= 0 || height <= 0) continue;

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
    const hasPixelUnit = Boolean(match[2] || match[4]);
    if (
      LAYOUT_COUNT_CONTEXT_AFTER.test(suffix ?? "") ||
      ASPECT_RATIO_CONTEXT_BEFORE.test(prefix ?? "") ||
      ASPECT_RATIO_CONTEXT_AFTER.test(suffix ?? "")
    ) {
      continue;
    }
    const hasDimensionContext =
      DIMENSION_CONTEXT_BEFORE.test(prefix ?? "") ||
      DIMENSION_CONTEXT_AFTER.test(suffix ?? "");
    const hasFormatContext =
      FORMAT_CONTEXT_BEFORE.test(prefix ?? "") ||
      FORMAT_CONTEXT_AFTER.test(suffix ?? "");
    const hasSmallFormatContext =
      SMALL_FORMAT_CONTEXT_BEFORE.test(prefix ?? "") ||
      SMALL_FORMAT_CONTEXT_AFTER.test(suffix ?? "");
    if (
      !hasPixelUnit &&
      !hasDimensionContext &&
      !hasFormatContext &&
      (width < 100 || height < 100) &&
      !hasSmallFormatContext
    ) {
      continue;
    }

    dimensionsByKey.set(`${width}x${height}`, { width, height });
  }

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
