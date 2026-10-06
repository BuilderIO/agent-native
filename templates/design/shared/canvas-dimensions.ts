export interface CanvasDimensions {
  width: number;
  height: number;
}

const DIMENSION_PAIR =
  /\b(\d{1,3}(?:,\d{3})+|\d{2,5})\s*(?:x|×|by)\s*(\d{1,3}(?:,\d{3})+|\d{2,5})\b/gi;
const DIMENSION_CONTEXT =
  /\b(?:exact(?:ly)?|fixed[- ]size|dimensions?|size|canvas|artboard|frame|screen|pixel|image|icon|ad|advertisement|banner|leaderboard|rectangle|skyscraper|billboard|cover|favicon|logo|avatar|mobile|tablet|social|post|story|email|newsletter|print|flyer|poster)\b/i;

export function explicitCanvasDimensionsFromPrompt(
  prompt?: string,
): CanvasDimensions | undefined {
  if (!prompt) return undefined;

  for (const match of prompt.matchAll(DIMENSION_PAIR)) {
    const width = Number(match[1]?.replace(/,/g, ""));
    const height = Number(match[2]?.replace(/,/g, ""));
    if (!Number.isFinite(width) || !Number.isFinite(height)) continue;
    if (width <= 0 || height <= 0) continue;

    const start = match.index ?? 0;
    const context = [
      prompt.slice(Math.max(0, start - 48), start),
      prompt.slice(start + match[0].length, start + match[0].length + 48),
    ].join(" ");
    const pixelUnit = /^\s*(?:px|pixels?)\b/i.test(
      prompt.slice(start + match[0].length),
    );
    if (
      (width < 100 || height < 100) &&
      !pixelUnit &&
      !DIMENSION_CONTEXT.test(context)
    ) {
      continue;
    }

    return { width, height };
  }

  return undefined;
}
