export const DEFAULT_SLIDE_BACKGROUND = "#FFFFFF"; // guard:allow-raw-color - default slide canvas fallback

export function backgroundCssValue(
  background: string | undefined,
): string | null {
  if (!background) return DEFAULT_SLIDE_BACKGROUND;
  const arbitrary = background.match(/^bg-\[(.+)\]$/);
  if (arbitrary) return arbitrary[1].replace(/_/g, " ");
  return background.startsWith("bg-") ? null : background;
}

export function resolveSlideBackground(
  background: string | undefined,
  designSystem?: {
    slideDefaults?: { background?: string };
    colors?: { background?: string };
  },
): string {
  return (
    background?.trim() ||
    designSystem?.slideDefaults?.background?.trim() ||
    designSystem?.colors?.background?.trim() ||
    DEFAULT_SLIDE_BACKGROUND
  );
}
