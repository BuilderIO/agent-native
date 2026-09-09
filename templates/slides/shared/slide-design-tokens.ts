import type { DesignSystemData } from "./api.js";

/**
 * Every `--ds-*` variable a rendered slide may read, with the value used when
 * no design system is linked.
 *
 * Slide HTML is authored against the design system's own token vocabulary —
 * a design-system read hands the agent `spacing.slidePadding` and
 * `typography.headingSizes.h2`, so it writes `padding: var(--slidePadding)`
 * and `font-size: var(--h2)`. An undefined custom property is invalid at
 * computed-value time, which does not fall back to a stylesheet rule: the
 * inline declaration still wins and computes to the property's initial value.
 * `padding` becomes `0`, element gaps vanish, and because
 * `.slide-content .fmd-slide h2` is `font-size: inherit` the heading collapses
 * to body size. The slide then renders as unpadded text clumped into one band
 * of an otherwise empty canvas.
 *
 * The `.fmd-slide` alias block in `app/global.css` maps that vocabulary onto
 * these names; keep the two in sync (enforced by
 * `slide-design-tokens.test.ts`).
 */
export const SLIDE_DESIGN_TOKEN_FALLBACKS = {
  // A slide canvas is not app chrome. These are the unbranded-deck defaults
  // for the slide surface itself, so they cannot route through the app's
  // shadcn theme: those tokens hold raw `H S% L%` channels that authored
  // slide HTML cannot use, which is the confusion this file exists to end.
  // They mirror the `.fmd-slide` fallbacks in app/global.css.
  "--ds-primary": "#609ff8", // guard:allow-raw-color — slide canvas default
  "--ds-secondary": "#4ade80", // guard:allow-raw-color — slide canvas default
  "--ds-accent": "#00e5ff", // guard:allow-raw-color — slide canvas default
  "--ds-bg": "#0b0b0d", // guard:allow-raw-color — slide canvas default
  "--ds-surface": "#0a0a0a", // guard:allow-raw-color — slide canvas default
  "--ds-text": "#ffffff", // guard:allow-raw-color — slide canvas default
  // guard:allow-raw-color — slide canvas default
  "--ds-text-muted": "rgba(255, 255, 255, 0.55)",
  "--ds-heading-font": '"Poppins", sans-serif',
  "--ds-body-font": '"Poppins", sans-serif',
  "--ds-heading-weight": "700",
  "--ds-body-weight": "400",
  "--ds-h1": "64px",
  "--ds-h2": "40px",
  "--ds-h3": "28px",
  "--ds-slide-padding": "64px 80px",
  "--ds-element-gap": "24px",
  "--ds-radius": "12px",
  "--ds-accent-width": "4px",
} as const;

export type SlideDesignTokenName = keyof typeof SLIDE_DESIGN_TOKEN_FALLBACKS;

export const SLIDE_DESIGN_TOKEN_NAMES = Object.keys(
  SLIDE_DESIGN_TOKEN_FALLBACKS,
) as SlideDesignTokenName[];

/**
 * Whether a token value is safe to write into a CSS declaration.
 *
 * The standalone HTML export interpolates these values straight into a
 * `<style>` element, and a design system is user-authored data, so a value
 * carrying `</style>`, an extra declaration, or an at-rule would escape its
 * declaration. Keep it to a single simple value: no markup, no declaration or
 * block punctuation, no at-rules, no `url()`/`expression()` payloads.
 */
export function isSafeSlideTokenValue(value: string): boolean {
  if (value.length > 200) return false;
  if (/[<>;{}@\\]/.test(value)) return false;
  return !/(?:url|expression|image-set)\s*\(|javascript:|data:/i.test(value);
}

/**
 * The `--ds-*` values for a linked design system.
 *
 * A token the system does not carry, or carries as a value that is not safe
 * to write into a stylesheet, is omitted rather than emitted empty, so the
 * documented fallback applies instead of an empty string silently zeroing the
 * property the way an undefined variable does.
 */
export function slideDesignSystemCssVariables(
  designSystem: DesignSystemData | null | undefined,
): Partial<Record<SlideDesignTokenName, string>> {
  if (!designSystem) return {};

  const { colors, typography, spacing, borders } = designSystem;
  const candidates: Array<[SlideDesignTokenName, string | undefined]> = [
    ["--ds-primary", colors?.primary],
    ["--ds-secondary", colors?.secondary],
    ["--ds-accent", colors?.accent],
    ["--ds-bg", colors?.background],
    ["--ds-surface", colors?.surface],
    ["--ds-text", colors?.text],
    ["--ds-text-muted", colors?.textMuted],
    ["--ds-heading-font", typography?.headingFont],
    ["--ds-body-font", typography?.bodyFont],
    ["--ds-heading-weight", typography?.headingWeight],
    ["--ds-body-weight", typography?.bodyWeight],
    ["--ds-h1", typography?.headingSizes?.h1],
    ["--ds-h2", typography?.headingSizes?.h2],
    ["--ds-h3", typography?.headingSizes?.h3],
    ["--ds-slide-padding", spacing?.slidePadding],
    ["--ds-element-gap", spacing?.elementGap],
    ["--ds-radius", borders?.radius],
    ["--ds-accent-width", borders?.accentWidth],
  ];

  const variables: Partial<Record<SlideDesignTokenName, string>> = {};
  for (const [name, value] of candidates) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || !isSafeSlideTokenValue(trimmed)) continue;
    variables[name] = trimmed;
  }
  return variables;
}

/**
 * The token names authored slide HTML actually references, mapped onto the
 * `--ds-*` variable that carries the value.
 *
 * These are the design system's own field names, because that is the
 * vocabulary every design-system read hands the agent, plus the small set of
 * CSS-framework synonyms that show up in real decks. `--background` and its
 * neighbours also exist at `:root` as shadcn's raw `H S% L%` channels, which
 * are not valid color values on their own — binding them inside `.fmd-slide`
 * is what makes an authored `background-color: var(--background)` paint at
 * all.
 */
export const SLIDE_TOKEN_ALIASES: Record<string, SlideDesignTokenName> = {
  "--primary": "--ds-primary",
  "--secondary": "--ds-secondary",
  "--accent": "--ds-accent",
  "--background": "--ds-bg",
  "--bg": "--ds-bg",
  "--surface": "--ds-surface",
  "--card": "--ds-surface",
  "--muted": "--ds-surface",
  "--text": "--ds-text",
  "--foreground": "--ds-text",
  "--textMuted": "--ds-text-muted",
  "--muted-foreground": "--ds-text-muted",
  "--border": "--ds-text-muted",
  "--headingFont": "--ds-heading-font",
  "--bodyFont": "--ds-body-font",
  "--headingWeight": "--ds-heading-weight",
  "--bodyWeight": "--ds-body-weight",
  "--h1": "--ds-h1",
  "--h2": "--ds-h2",
  "--h3": "--ds-h3",
  "--slidePadding": "--ds-slide-padding",
  "--elementGap": "--ds-element-gap",
  "--radius": "--ds-radius",
  "--accentWidth": "--ds-accent-width",
};

/** The alias block as CSS declarations, for renderers that emit a stylesheet. */
export function slideTokenAliasDeclarations(): string {
  return Object.entries(SLIDE_TOKEN_ALIASES)
    .map(
      ([alias, token]) =>
        `      ${alias}: var(${token}, ${SLIDE_DESIGN_TOKEN_FALLBACKS[token]});`,
    )
    .join("\n");
}

/**
 * A `:root` declaration block for renderers that emit their own stylesheet
 * (the standalone HTML export) rather than inline React styles.
 */
export function slideDesignSystemCssRootBlock(
  designSystem: DesignSystemData | null | undefined,
): string {
  const variables = slideDesignSystemCssVariables(designSystem);
  const declarations = Object.entries(variables)
    .map(([name, value]) => `      ${name}: ${value};`)
    .join("\n");
  return declarations ? `    :root {\n${declarations}\n    }` : "";
}
