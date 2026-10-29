import type { DesignSystemData } from "@shared/api";

export const SLIDE_FONT_SIZE_MIN = 8;
export const SLIDE_FONT_SIZE_MAX = 160;

const HEADING_LEVELS = ["h1", "h2", "h3"] as const;

export type SlideHeadingLevel = (typeof HEADING_LEVELS)[number];

/**
 * The deck's heading sizes that are plain pixel lengths. A rem, clamp(), or
 * other CSS length has no single size the field could show, so it is left out.
 */
export function deckHeadingSizes(
  designSystem: DesignSystemData | undefined,
): { level: SlideHeadingLevel; value: number }[] {
  const sizes = designSystem?.typography.headingSizes;
  if (!sizes) return [];
  return HEADING_LEVELS.flatMap((level) => {
    const match = /^\s*(\d+(?:\.\d+)?)px\s*$/.exec(sizes[level]);
    if (!match) return [];
    const value = Number(match[1]);
    return value >= SLIDE_FONT_SIZE_MIN && value <= SLIDE_FONT_SIZE_MAX
      ? [{ level, value }]
      : [];
  });
}
