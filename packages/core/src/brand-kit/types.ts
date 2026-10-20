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

export interface BrandKitToken {
  name: string;
  cssVar: string;
  value: string;
  type: BrandKitTokenType;
  group?: string;
  source?: string;
}

export interface BrandKitTypography {
  headingFont: string;
  bodyFont: string;
  headingWeight: string;
  bodyWeight: string;
  headingSizes: { h1: string; h2: string; h3: string };
}

export interface BrandKitSpacing {
  elementGap: string;
  [paddingKey: string]: string;
}

export interface BrandKitBorders {
  radius: string;
  accentWidth: string;
}

export interface BrandKitDefaults {
  background: string;
  labelStyle: "uppercase" | "lowercase" | "capitalize" | "none";
}

export interface BrandKitLogo {
  url: string;
  name: string;
  variant: "light" | "dark" | "auto";
}

export interface BrandKitImageStyle {
  referenceUrls: string[];
  styleDescription: string;
}

export interface BrandKitData {
  colors: BrandKitColors;
  typography: BrandKitTypography;
  spacing: BrandKitSpacing;
  borders: BrandKitBorders;
  logos: BrandKitLogo[];
  tokens?: BrandKitToken[];
  imageStyle?: BrandKitImageStyle;
  customCSS?: string;
  notes?: string;
}

export type DesignSystemData = BrandKitData;

export type BrandKitSource =
  | "figma"
  | "figma-file"
  | "code"
  | "github"
  | "url"
  | "document"
  | "manual";

export interface BrandWebsiteSignals {
  url: string;
  themeColor?: string;
  cssCustomProperties?: Record<string, string>;
  fontFaces?: { family?: string; src?: string }[];
  pageTitle?: string;
  metaDescription?: string;
}
