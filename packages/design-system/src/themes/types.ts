import type { AppearanceTokens } from "../tokens/palette.js";
import type { TokenMap } from "../tokens/primitives.js";

/**
 * A theme's own values, keyed by custom property name without the leading
 * dashes: the shadcn slots (`primary`, `border`, `radius`, as HSL triplets or
 * lengths) and any other value the theme sets (`font-sans`). `base` applies at
 * the theme root; `dark` and `light` override it under `.dark` and `.light`.
 */
export interface ThemeValues {
  base: Readonly<Record<string, string>>;
  dark?: Readonly<Record<string, string>>;
  light?: Readonly<Record<string, string>>;
}

/**
 * One theme: everything an app picks with `data-app-theme` (palette, type, shape
 * and part sizes). Each section is written to CSS as is; none of it reads a
 * variable an app defines.
 */
export interface ThemeDefinition {
  /** The `data-app-theme` value: an app's name, or `agent-native`. */
  name: string;
  label: string;
  /** Applied with no `data-app-theme` attribute. Exactly one theme is the default. */
  isDefault: boolean;
  /** Roles and values at the theme root, in its default appearance. */
  base: TokenMap;
  /** Under `.dark`: a complete set, so a dark subtree of a light page resolves alone. */
  dark: TokenMap;
  /** Under `.light`: a complete set, likewise. */
  light: TokenMap;
  /**
   * The theme's own color scales in each appearance, generated from its
   * colors, so a part's `--accent-*` and `--gray-*` steps are this theme's
   * wherever its attribute applies.
   */
  palette: { light: AppearanceTokens; dark: AppearanceTokens };
  /** Appearance-independent values (sizes, shapes), set once at the theme root. */
  tokens: TokenMap;
  /**
   * The roles read the color scales, so they are re-declared wherever the
   * scales change (`.light`, `.dark`, `[data-palette]`).
   */
  readsScales: boolean;
  /**
   * Values written only inside this theme's own scope. They override toolkit
   * and Tailwind defaults (the sans font, the composer's radius), so they
   * never apply without the attribute and no other theme resets them: a
   * reset to `initial` would erase those defaults, not restore them.
   */
  scopedOnly?: { base: TokenMap; dark: TokenMap };
}
