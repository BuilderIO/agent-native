import type {
  BrandKitData,
  BrandKitToken,
  BrandKitTokenType,
} from "@agent-native/core/brand-kit";
import {
  classifyBrandKitToken,
  friendlyTokenName,
  normalizeBrandWebsiteUrl,
} from "@agent-native/core/brand-kit";
import type {
  WebsiteDesignTokens,
  WebsiteExtraction,
} from "@agent-native/core/ingestion";

import {
  LayeredRenderedPageProvider,
  type RenderedPageProvider,
  type RenderedPageRequest,
  type RenderedPageResult,
} from "./rendered-page.js";

const MAX_DESIGN_MD_CHARS = 20_000;
const MAX_TOKENS = 500;
const FALLBACK_COLORS = {
  primary: "#111827",
  secondary: "#374151",
  accent: "#2563EB",
  background: "#FFFFFF",
  surface: "#F9FAFB",
  text: "#111827",
  textMuted: "#6B7280",
} as const;

export type RenderedDesignExtractionStatus = "complete" | "partial" | "failed";

export interface RenderedDesignExtraction {
  status: RenderedDesignExtractionStatus;
  url: string;
  finalUrl?: string;
  title?: string;
  rendered: boolean;
  method?: RenderedPageResult["method"];
  confidence?: number;
  designTokens?: WebsiteDesignTokens;
  designMd?: string;
  brandKit?: BrandKitData;
  /** Back-compat projections for callers that consumed the old URL action. */
  pageTitle?: string;
  cssCustomProperties?: Record<string, string>;
  colors?: string[];
  fonts?: string[];
  fontFaces?: Array<{ family: string; weight?: string }>;
  googleFonts?: string[];
  stylesheetUrls?: string[];
  assets?: RenderedPageResult["extraction"]["assets"];
  screenshotEvidence?: Array<{
    viewport: "desktop" | "mobile";
    width: number;
    height: number;
    bytes: number;
  }>;
  warnings: string[];
  diagnostics: string[];
  error?: string;
}

export interface ExtractRenderedDesignOptions extends Pick<
  RenderedPageRequest,
  "timeoutMs" | "preferHosted"
> {
  provider?: RenderedPageProvider;
}

/**
 * Extract a bounded visual language from a public website. Browser rendering
 * is deliberately delegated to the layered provider so this works with
 * Builder Browser, local Playwright, an approved attached browser, or the
 * existing SSRF-safe static fallback without changing app code.
 */
export async function extractRenderedDesignSystemFromUrl(
  websiteUrl: string,
  options: ExtractRenderedDesignOptions = {},
): Promise<RenderedDesignExtraction> {
  let url: string;
  try {
    url = normalizeBrandWebsiteUrl(websiteUrl);
  } catch (error) {
    return failedExtraction(websiteUrl, error);
  }

  const provider = options.provider ?? new LayeredRenderedPageProvider();
  let page: RenderedPageResult;
  try {
    page = await provider.render({
      url,
      timeoutMs: options.timeoutMs,
      preferHosted: options.preferHosted,
      waitUntil: "load",
    });
  } catch (error) {
    return failedExtraction(url, error);
  }

  const designTokens = page.extraction.designTokens;
  const designMd = buildDesignMarkdown({
    url,
    finalUrl: page.finalUrl,
    title: page.title,
    rendered: page.rendered,
    method: page.method,
    confidence: page.confidence,
    designTokens,
    warnings: page.warnings,
  });
  const status: RenderedDesignExtractionStatus = page.rendered
    ? page.warnings.length > 0 || page.screenshots.length < 2
      ? "partial"
      : "complete"
    : "partial";

  return {
    status,
    url,
    finalUrl: page.finalUrl,
    title: page.title,
    rendered: page.rendered,
    method: page.method,
    confidence: page.confidence,
    designTokens,
    designMd,
    brandKit: brandKitDataFromExtraction({
      url,
      finalUrl: page.finalUrl,
      title: page.title,
      designTokens,
      designMd,
      assets: page.extraction.assets,
    }),
    pageTitle: page.title,
    cssCustomProperties: designTokens.cssVariables,
    colors: designTokens.colors,
    fonts: uniqueStrings(
      designTokens.typography.map((style) => firstFontFamily(style.family)),
    ),
    fontFaces: designTokens.typography.slice(0, 24).map((style) => ({
      family: firstFontFamily(style.family),
      weight: style.weight,
    })),
    googleFonts: uniqueStrings(
      designTokens.typography.map((style) => firstFontFamily(style.family)),
    ),
    stylesheetUrls: page.extraction.assets
      .filter((asset) => asset.kind === "stylesheet")
      .map((asset) => asset.url)
      .slice(0, 64),
    assets: page.extraction.assets,
    screenshotEvidence: page.screenshots.map((screenshot) => ({
      viewport: screenshot.viewport,
      width: screenshot.width,
      height: screenshot.height,
      bytes: screenshot.data.byteLength,
    })),
    warnings: page.warnings,
    diagnostics: page.diagnostics,
  };
}

/** Convert the shared browser result into the Assets style-brief vocabulary. */
export function styleBriefFromRenderedDesign(
  extraction: RenderedDesignExtraction,
): Record<string, unknown> {
  const tokens = extraction.designTokens;
  const typography = tokens?.typography ?? [];
  const componentStyles = tokens?.components ?? [];
  const semanticColors = tokens?.semanticColors ?? {};
  const bodyTypography = componentStyles.find((style) => style.role === "body");
  const headingTypography = componentStyles.find(
    (style) => style.role === "heading",
  );

  return {
    description: extraction.finalUrl
      ? `Rendered visual language extracted from ${extraction.finalUrl}.`
      : "Rendered visual language extracted from a website.",
    palette: tokens?.colors?.slice(0, 12) ?? [],
    fontFamilies: uniqueStrings(
      typography.map((style) => firstFontFamily(style.family)),
    ),
    fontWeights: uniqueStrings(
      typography
        .map((style) => style.weight)
        .concat(componentStyles.map((style) => style.fontWeight ?? "")),
    ),
    typographyPolicy: typographyPolicy(headingTypography, bodyTypography),
    composition: tokens?.layout
      ? `Content width ${tokens.layout.contentWidth ?? "fluid"}; page padding ${tokens.layout.pagePadding ?? "not observed"}; section gap ${tokens.layout.sectionGap ?? "not observed"}.`
      : undefined,
    sourceUrl: extraction.finalUrl ?? extraction.url,
    rendered: extraction.rendered,
    designMd: extraction.designMd,
    semanticColors,
    spacing: tokens?.spacing?.slice(0, 24),
    radii: tokens?.radii?.slice(0, 16),
    shadows: tokens?.shadows?.slice(0, 12),
    backgrounds: tokens?.backgrounds?.slice(0, 12),
    componentStyles: componentStyles.slice(0, 12),
    cssVariables: tokens?.cssVariables,
    warnings: extraction.warnings,
  };
}

export function brandKitDataFromExtraction(input: {
  url: string;
  finalUrl?: string;
  title?: string;
  designTokens: WebsiteDesignTokens;
  designMd: string;
  assets?: RenderedPageResult["extraction"]["assets"];
}): BrandKitData {
  const tokens = input.designTokens;
  const semantic = tokens.semanticColors ?? {};
  const colors = {
    primary: semantic.primary ?? tokens.colors[0] ?? FALLBACK_COLORS.primary,
    secondary:
      semantic.secondary ?? tokens.colors[1] ?? FALLBACK_COLORS.secondary,
    accent: semantic.accent ?? tokens.colors[0] ?? FALLBACK_COLORS.accent,
    background:
      semantic.background ?? tokens.colors[2] ?? FALLBACK_COLORS.background,
    surface: semantic.surface ?? tokens.colors[3] ?? FALLBACK_COLORS.surface,
    text: semantic.text ?? tokens.colors[4] ?? FALLBACK_COLORS.text,
    textMuted:
      semantic.textMuted ?? tokens.colors[5] ?? FALLBACK_COLORS.textMuted,
  };
  const heading = tokens.components?.find(
    (component) => component.role === "heading",
  );
  const body = tokens.components?.find(
    (component) => component.role === "body",
  );
  const typography = tokens.typography;
  const headingTypography = typography[0];
  const bodyTypography = typography[1] ?? typography[0];
  const source = input.finalUrl ?? input.url;

  return {
    colors,
    typography: {
      headingFont:
        firstFontFamily(heading?.fontFamily ?? headingTypography?.family) ||
        "system-ui",
      bodyFont:
        firstFontFamily(body?.fontFamily ?? bodyTypography?.family) ||
        "system-ui",
      headingWeight: heading?.fontWeight ?? headingTypography?.weight ?? "700",
      bodyWeight: body?.fontWeight ?? bodyTypography?.weight ?? "400",
      headingSizes: {
        h1: componentFontSize(tokens, "heading", "h1") ?? "48px",
        h2: componentFontSize(tokens, "heading", "h2") ?? "36px",
        h3: componentFontSize(tokens, "heading", "h3") ?? "24px",
      },
    },
    spacing: {
      pagePadding: tokens.layout?.pagePadding ?? tokens.spacing[0] ?? "24px",
      elementGap: tokens.layout?.sectionGap ?? tokens.spacing[1] ?? "16px",
    },
    borders: {
      radius: tokens.radii[0] ?? "8px",
      accentWidth: "0px",
    },
    logos: (input.assets ?? [])
      .filter((asset) => asset.role === "logo")
      .slice(0, 12)
      .map((asset, index) => ({
        url: asset.url,
        name: `Logo ${index + 1}`,
        variant: "auto" as const,
      })),
    tokens: tokensToBrandKitTokens(tokens, source),
    notes: [
      `Source: ${source}`,
      input.title ? `Page title: ${input.title}` : "",
      "The values above were inferred from the live computed browser cascade.",
      input.designMd,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

export function buildDesignMarkdown(input: {
  url: string;
  finalUrl: string;
  title: string;
  rendered: boolean;
  method: RenderedPageResult["method"];
  confidence: number;
  designTokens: WebsiteDesignTokens;
  warnings: string[];
}): string {
  const tokens = input.designTokens;
  const semantic = tokens.semanticColors ?? {};
  const lines = [
    `# ${safeHeading(input.title || new URL(input.finalUrl).hostname)} design system`,
    "",
    `Source: ${input.finalUrl}`,
    `Extraction: ${input.rendered ? "real browser computed styles" : "SSRF-safe static HTML fallback"} (${input.method}; confidence ${Math.round(input.confidence * 100)}%)`,
    "",
    "## Colors",
    ...roleLines(semantic),
    ...(tokens.colors.length > 0
      ? ["", `Observed palette: ${tokens.colors.slice(0, 16).join(", ")}`]
      : ["", "No visible color samples were available."]),
    "",
    "## Typography",
    ...tokens.typography
      .slice(0, 12)
      .map(
        (style) =>
          `- ${style.family}; ${style.size}; weight ${style.weight}; line-height ${style.lineHeight}; tracking ${style.letterSpacing}`,
      ),
    ...(tokens.typography.length === 0
      ? ["- No visible typography samples were available."]
      : []),
    "",
    "## Spacing, shape, and depth",
    `- Spacing: ${tokens.spacing.slice(0, 20).join(", ") || "not observed"}`,
    `- Radii: ${tokens.radii.slice(0, 12).join(", ") || "not observed"}`,
    `- Shadows: ${(tokens.shadows ?? []).slice(0, 8).join("; ") || "not observed"}`,
    `- Background treatments: ${(tokens.backgrounds ?? []).slice(0, 8).join("; ") || "not observed"}`,
    ...(tokens.layout
      ? [
          `- Layout: content width ${tokens.layout.contentWidth ?? "fluid"}; page padding ${tokens.layout.pagePadding ?? "not observed"}; section gap ${tokens.layout.sectionGap ?? "not observed"}`,
        ]
      : []),
    "",
    "## Component language",
    ...(tokens.components ?? [])
      .slice(0, 12)
      .map((component) =>
        [
          `- ${component.role}:`,
          component.fontFamily,
          component.fontSize ? `size ${component.fontSize}` : undefined,
          component.fontWeight ? `weight ${component.fontWeight}` : undefined,
          component.color ? `color ${component.color}` : undefined,
          component.backgroundColor
            ? `background ${component.backgroundColor}`
            : undefined,
          component.backgroundImage
            ? `background image ${component.backgroundImage}`
            : undefined,
          component.borderRadius
            ? `radius ${component.borderRadius}`
            : undefined,
          component.boxShadow ? `shadow ${component.boxShadow}` : undefined,
          component.padding ? `padding ${component.padding}` : undefined,
          component.textTransform
            ? `case ${component.textTransform}`
            : undefined,
        ]
          .filter(Boolean)
          .join("; "),
      ),
    ...((tokens.components ?? []).length === 0
      ? ["- No representative visible component styles were available."]
      : []),
    "",
    "## CSS variables",
    ...Object.entries(tokens.cssVariables)
      .slice(0, 64)
      .map(([name, value]) => `- ${name}: ${value}`),
    ...(Object.keys(tokens.cssVariables).length === 0
      ? ["- No root CSS custom properties were available."]
      : []),
    ...(input.warnings.length > 0
      ? [
          "",
          "## Extraction notes",
          ...input.warnings.map((warning) => `- ${warning}`),
        ]
      : []),
  ];
  return lines.join("\n").slice(0, MAX_DESIGN_MD_CHARS);
}

function failedExtraction(
  url: string,
  error: unknown,
): RenderedDesignExtraction {
  const message = error instanceof Error ? error.message : String(error);
  return {
    status: "failed",
    url,
    rendered: false,
    warnings: [],
    diagnostics: [],
    error: message,
  };
}

function roleLines(
  colors: NonNullable<WebsiteDesignTokens["semanticColors"]>,
): string[] {
  const roles = [
    "primary",
    "secondary",
    "accent",
    "background",
    "surface",
    "text",
    "textMuted",
  ] as const;
  return roles.map((role) => `- ${role}: ${colors[role] ?? "not observed"}`);
}

function firstFontFamily(value: string | undefined): string {
  return (
    value
      ?.split(",")[0]
      ?.trim()
      .replace(/^['"]|['"]$/g, "") ?? ""
  );
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function typographyPolicy(
  heading: NonNullable<WebsiteDesignTokens["components"]>[number] | undefined,
  body: NonNullable<WebsiteDesignTokens["components"]>[number] | undefined,
): string | undefined {
  if (!heading && !body) return undefined;
  return [
    heading
      ? `Headings use ${firstFontFamily(heading.fontFamily)} at ${heading.fontWeight ?? "default"} weight.`
      : "",
    body
      ? `Body copy uses ${firstFontFamily(body.fontFamily)} at ${body.fontWeight ?? "default"} weight.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function componentFontSize(
  tokens: WebsiteDesignTokens,
  role: "heading",
  level: "h1" | "h2" | "h3",
): string | undefined {
  const heading = tokens.components?.find(
    (component) => component.role === role,
  );
  if (!heading?.fontSize) return undefined;
  if (level === "h1") return heading.fontSize;
  const numeric = Number.parseFloat(heading.fontSize);
  if (!Number.isFinite(numeric)) return heading.fontSize;
  return `${Math.max(level === "h2" ? 24 : 18, Math.round(numeric * (level === "h2" ? 0.75 : 0.58)))}px`;
}

function tokensToBrandKitTokens(
  tokens: WebsiteDesignTokens,
  source: string,
): BrandKitToken[] {
  const entries = Object.entries(tokens.cssVariables).slice(0, MAX_TOKENS);
  const cssTokens = entries.map(([cssVar, value]) => ({
    name: friendlyTokenName(cssVar),
    cssVar,
    value,
    type: classifyBrandKitToken(cssVar, value),
    source,
  }));
  const observedColors = tokens.colors.slice(0, 32).map((value, index) => ({
    name: `Observed Color ${index + 1}`,
    cssVar: `--observed-color-${index + 1}`,
    value,
    type: "color" as const satisfies BrandKitTokenType,
    source,
  }));
  return [...cssTokens, ...observedColors].slice(0, MAX_TOKENS);
}

function safeHeading(value: string): string {
  return (
    value
      .replace(/[\r\n#]/g, " ")
      .trim()
      .slice(0, 160) || "Website"
  );
}
