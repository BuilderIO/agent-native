export const DEFAULT_SLIDE_BACKGROUND = "#F5F2EA"; // guard:allow-raw-color - default slide canvas fallback

// `slide.background` holds either a raw CSS value or a Tailwind arbitrary
// class (`bg-[...]`), which SlideRenderer applies as a class rather than
// an inline style. Callers that only speak CSS colors unwrap the arbitrary
// form and get `null` for anything else (named utilities, gradients) rather
// than a guessed hex the slide is not actually using.
export function backgroundCssValue(
  background: string | undefined,
): string | null {
  if (!background) return DEFAULT_SLIDE_BACKGROUND;
  const arbitrary = background.match(/^bg-\[(.+)\]$/);
  if (arbitrary) return arbitrary[1].replace(/_/g, " ");
  return background.startsWith("bg-") ? null : background;
}
