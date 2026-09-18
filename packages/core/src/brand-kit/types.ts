/**
 * Shared "Brand Kit" data model.
 *
 * A Brand Kit is the reusable, template-agnostic brand container: design-system
 * tokens (colors, typography, spacing, borders), brand assets (logos, reference
 * images), and free-form custom instructions / voice. It is extracted from a
 * Figma file, code/GitHub repo, URL, or documents and used to generate
 * on-brand content (designs, slide themes, images).
 *
 * These types are intentionally pure — no framework, DB, or template imports —
 * so every template (design, slides, …) can re-export and narrow them instead
 * of copy-pasting their own definitions. Templates persist a Brand Kit row in
 * their own `design_systems` table (the internal/DB identifier stays stable);
 * the JSON stored in the `data` column conforms to {@link BrandKitData}.
 */

/** Brand color roles. */
export interface BrandKitColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  textMuted: string;
}

/**
 * Semantic category a {@link BrandKitToken} belongs to.
 *
 * `motion` covers durations, easings, and transitions — the DTCG `duration`,
 * `cubicBezier`, and `transition` types. It exists because a design system's
 * motion is part of its identity, and a category-less token is a dropped one:
 * extractors discard what they cannot classify, so "no bucket" silently became
 * "no motion in any imported system".
 */
export type BrandKitTokenType =
  | "color"
  | "typography"
  | "spacing"
  | "radius"
  | "shadow"
  | "motion"
  | "other";

/**
 * One token under the name its source design system uses. The seven
 * {@link BrandKitColors} roles are a summary view, not a substitute: collapsing
 * `interactive-01` into `secondary` discards the only name the design team has.
 */
export interface BrandKitToken {
  name: string;
  /** e.g. `--cds-interactive-01`. */
  cssVar: string;
  /** Resolved value, e.g. a hex color or `0.5rem`. */
  value: string;
  type: BrandKitTokenType;
  /** Collection path as the source organises it, e.g. `Colors/Interactive`. */
  group?: string;
  /** e.g. `Carbon v11` or `globals.css`. */
  source?: string;
}

/** Brand typography system. */
export interface BrandKitTypography {
  headingFont: string;
  bodyFont: string;
  headingWeight: string;
  bodyWeight: string;
  headingSizes: { h1: string; h2: string; h3: string };
}

/** Spacing rhythm. The padding key is template-specific (e.g. `pagePadding`
 * in design, `slidePadding` in slides), so it stays open while `elementGap`
 * is shared. */
export interface BrandKitSpacing {
  elementGap: string;
  [paddingKey: string]: string;
}

/** Corner / border character. */
export interface BrandKitBorders {
  radius: string;
  accentWidth: string;
}

/** Surface defaults applied when generating content. The key wrapping these
 * (`defaults` in design, `slideDefaults` in slides) is template-specific, so
 * the shape is shared but the field name stays per-template. */
export interface BrandKitDefaults {
  background: string;
  labelStyle: "uppercase" | "lowercase" | "capitalize" | "none";
}

/** A brand logo reference. */
export interface BrandKitLogo {
  url: string;
  name: string;
  variant: "light" | "dark" | "auto";
}

/** Reference imagery + a description guiding on-brand image generation. */
export interface BrandKitImageStyle {
  referenceUrls: string[];
  styleDescription: string;
}

/**
 * The core token shape stored in a Brand Kit's `data` JSON. Templates extend
 * this with their domain-specific spacing-padding and defaults keys
 * (`pagePadding`/`defaults` vs `slidePadding`/`slideDefaults`).
 */
export interface BrandKitData {
  colors: BrandKitColors;
  typography: BrandKitTypography;
  spacing: BrandKitSpacing;
  borders: BrandKitBorders;
  logos: BrandKitLogo[];
  /**
   * The source system's full named vocabulary. Optional because kits predating
   * it store only the role summary - absent means "never extracted", not "the
   * system has none".
   */
  tokens?: BrandKitToken[];
  imageStyle?: BrandKitImageStyle;
  customCSS?: string;
  notes?: string;
}

/**
 * Back-compat alias. The internal/DB concept is still called a "design
 * system"; the user-facing name is "Brand Kit". Both names map to the same
 * token shape so existing `DesignSystemData` imports keep working.
 */
export type DesignSystemData = BrandKitData;

/** Source a Brand Kit's tokens were extracted from. */
export type BrandKitSource =
  | "figma"
  | "figma-file"
  | "code"
  | "github"
  | "url"
  | "document"
  | "manual";

/** Structured brand signals scraped from a website's HTML. */
export interface BrandWebsiteSignals {
  url: string;
  themeColor?: string;
  cssCustomProperties?: Record<string, string>;
  fontFaces?: { family?: string; src?: string }[];
  pageTitle?: string;
  metaDescription?: string;
}
