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

/**
 * The Tailwind background utilities a slide background can be set to, and the
 * CSS value each one paints. A named utility carries no value in the markup,
 * so anything that has to measure the canvas — the standalone HTML export, the
 * contrast audit — needs this table to see the color the viewer sees.
 */
const TAILWIND_BACKGROUND_VALUES: Record<string, string> = {
  // guard:allow-raw-color - Tailwind background utility value
  "bg-black": "#000000",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-white": "#FFFFFF",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-slate-900": "#0F172A",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-slate-950": "#020617",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-gray-900": "#111827",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-zinc-900": "#18181B",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-neutral-900": "#171717",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-stone-900": "#1C1917",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-red-500": "#EF4444",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-orange-500": "#F97316",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-amber-500": "#F59E0B",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-yellow-400": "#FACC15",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-lime-500": "#84CC16",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-green-500": "#22C55E",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-emerald-500": "#10B981",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-teal-500": "#14B8A6",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-cyan-500": "#06B6D4",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-sky-500": "#0EA5E9",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-blue-500": "#3B82F6",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-indigo-500": "#6366F1",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-indigo-950": "#1E1B4B",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-violet-500": "#8B5CF6",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-purple-600": "#9333EA",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-fuchsia-500": "#D946EF",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-pink-500": "#EC4899",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-rose-500": "#F43F5E",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-slate-700": "#334155",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-slate-800": "#1E293B",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-zinc-50": "#FAFAFA",
  // guard:allow-raw-color - Tailwind background utility value
  "bg-gray-100": "#F3F4F6",
};

const TAILWIND_GRADIENT_DIRECTIONS: Record<string, string> = {
  "bg-gradient-to-t": "to top",
  "bg-gradient-to-tr": "to top right",
  "bg-gradient-to-r": "to right",
  "bg-gradient-to-br": "to bottom right",
  "bg-gradient-to-b": "to bottom",
  "bg-gradient-to-bl": "to bottom left",
  "bg-gradient-to-l": "to left",
  "bg-gradient-to-tl": "to top left",
};

/**
 * The CSS value a slide background paints, resolving the Tailwind utilities
 * `backgroundCssValue` leaves as null. Returns null when the value names no
 * color this module can read, which callers must keep distinct from a canvas
 * they simply have not looked up.
 */
export function tailwindBackgroundCssValue(value: string): string | null {
  const cssValue = backgroundCssValue(value);
  if (cssValue) return cssValue;
  const classes = value.split(/\s+/);
  const solidBackground = classes.find(
    (className) => TAILWIND_BACKGROUND_VALUES[className],
  );
  if (solidBackground) return TAILWIND_BACKGROUND_VALUES[solidBackground];
  const direction = classes.find(
    (className) => TAILWIND_GRADIENT_DIRECTIONS[className],
  );
  if (direction) {
    const stops = classes
      .filter((className) => /^(?:from|via|to)-/.test(className))
      .map((className) => {
        const [, color, shade] =
          className.match(/^(?:from|via|to)-([\w]+)-([\d]+)$/) ?? [];
        return color && shade
          ? TAILWIND_BACKGROUND_VALUES[`bg-${color}-${shade}`]
          : undefined;
      })
      .filter((stop): stop is string => Boolean(stop));
    if (stops.length >= 2) {
      return `linear-gradient(${TAILWIND_GRADIENT_DIRECTIONS[direction]}, ${stops.join(", ")})`;
    }
  }
  return TAILWIND_BACKGROUND_VALUES[value] ?? null;
}

/**
 * The canvas a contrast audit can measure a slide's text against: the declared
 * CSS value, or the value behind a supported Tailwind utility. Null means the
 * canvas cannot be read, never that it is readable.
 */
export function backgroundContrastValue(
  background: string | undefined,
): string | null {
  if (!background) return null;
  return tailwindBackgroundCssValue(background);
}
