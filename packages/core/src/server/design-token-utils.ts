/**
 * Shared design-token extraction utilities.
 *
 * Pure functions for parsing Tailwind configs, CSS files, package.json,
 * documents, and URLs to extract colors, fonts, spacing, border-radius,
 * and CSS custom properties. Used by the import-* actions across all
 * templates (design, slides, videos).
 *
 * No framework dependencies — no defineAction, no zod, no drizzle.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of files to fetch from a single GitHub repo. */
export const MAX_FILES = 10;

/** Maximum individual file size (100 KB). */
export const MAX_FILE_SIZE = 100 * 1024;

/** Timeout for GitHub API / URL fetch calls (ms). */
export const FETCH_TIMEOUT = 15000;

/** File-name patterns to look for at the repo root. */
export const ROOT_PATTERNS: RegExp[] = [
  /^tailwind\.config\.\w+$/,
  /^postcss\.config\.\w+$/,
  /^\.?theme\.\w+$/,
  /^\.?tokens\.\w+$/,
  /^package\.json$/,
  /\.css$/,
];

/** Secondary paths (files and directories) to check for design tokens. */
export const SECONDARY_PATHS: string[] = [
  "src/styles",
  "styles",
  "src/theme",
  "app/globals.css",
  "src/globals.css",
  "src/index.css",
  "app/layout.tsx",
  "src/app/globals.css",
];

/** Maximum files accepted in import-code. */
export const CODE_MAX_FILES = 20;

/** Maximum total bytes accepted in import-code. */
export const CODE_MAX_TOTAL_BYTES = 500 * 1024;

/** Regex for hex colors (3-8 digit, including alpha). */
export const HEX_COLOR_RE = /#(?:[0-9a-fA-F]{3,4}){1,2}\b/g;

/** Regex for well-known named CSS colors. */
export const NAMED_COLOR_RE =
  /\b(red|blue|green|yellow|orange|purple|pink|cyan|magenta|teal|navy|maroon|coral|salmon|gold|silver|gray|grey|indigo|violet|lime|olive|aqua|fuchsia|crimson|turquoise|ivory|beige|lavender|tan|khaki|plum|orchid|sienna)\b/gi;

/** Regex for well-known font family names found in documents. */
export const FONT_NAME_RE =
  /\b(Helvetica|Arial|Times New Roman|Georgia|Garamond|Futura|Bodoni|Avenir|Proxima Nova|Montserrat|Open Sans|Lato|Poppins|Raleway|Playfair Display|Merriweather|Source Sans|Noto Sans|Work Sans|Nunito|Rubik|Oswald|Roboto|Inter|DM Sans|Space Grotesk|SF Pro|Segoe UI|Calibri|Cambria|Century Gothic|Franklin Gothic|Gill Sans|Fira Sans|Barlow|Manrope|Sora|Plus Jakarta Sans|IBM Plex Sans|IBM Plex Serif|Libre Baskerville|Cormorant|Crimson Text)\b/gi;

/** Regex matching CSS custom property values that look like colors. */
export const COLOR_VAR_PATTERN =
  /^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|oklch\(|color\()/;

/** Well-known styling framework deps to detect in package.json. */
export const FRAMEWORK_DETECTORS: { name: string; label: string }[] = [
  { name: "tailwindcss", label: "tailwind" },
  { name: "@tailwindcss/cli", label: "tailwind" },
  { name: "styled-components", label: "styled-components" },
  { name: "@emotion/react", label: "emotion" },
  { name: "@emotion/styled", label: "emotion" },
  { name: "sass", label: "sass" },
  { name: "less", label: "less" },
  { name: "postcss", label: "postcss" },
  { name: "css-modules", label: "css-modules" },
  { name: "@vanilla-extract/css", label: "vanilla-extract" },
  { name: "stitches", label: "stitches" },
  { name: "panda-css", label: "panda-css" },
  { name: "@pandacss/dev", label: "panda-css" },
  { name: "unocss", label: "unocss" },
  { name: "windicss", label: "windi" },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContentType =
  | "presentation"
  | "document"
  | "spreadsheet"
  | "pdf"
  | "other";

export interface ParsedCss {
  cssCustomProperties: Record<string, string> | undefined;
  fonts: string[] | undefined;
}

export interface ParsedTailwindConfig {
  colors?: Record<string, string>;
  fontFamily?: Record<string, string>;
  spacing?: Record<string, string>;
  borderRadius?: Record<string, string>;
}

export interface CodeAnalysisState {
  colors: Record<string, string>;
  cssCustomProperties: Record<string, string>;
  fonts: { family: string; source?: string }[];
  spacing: Record<string, string>;
  borderRadius: Record<string, string>;
  stylingFramework: string | null;
  rawExtracts: { filename: string; type: string; data: unknown }[];
  seenFonts: Set<string>;
}

export interface UrlExtractionResult {
  url: string;
  pageTitle?: string;
  metaDescription?: string;
  themeColor?: string;
  cssCustomProperties?: Record<string, string>;
  colors?: string[];
  fontFaces?: { family?: string; src?: string }[];
  googleFonts?: string[];
  ogImage?: string;
  favicon?: string;
}

// ---------------------------------------------------------------------------
// SSRF Guard
// ---------------------------------------------------------------------------

/** Validate a URL is safe to fetch (blocks localhost, private IPs, metadata endpoints). */
export function validateUrl(url: string): void {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are allowed");
  }
  const hostname = parsed.hostname;
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]" ||
    hostname.startsWith("10.") ||
    hostname.startsWith("172.16.") ||
    hostname.startsWith("172.17.") ||
    hostname.startsWith("172.18.") ||
    hostname.startsWith("172.19.") ||
    hostname.startsWith("172.2") ||
    hostname.startsWith("172.30.") ||
    hostname.startsWith("172.31.") ||
    hostname.startsWith("192.168.") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".local") ||
    hostname === "metadata.google.internal" ||
    hostname === "169.254.169.254"
  ) {
    throw new Error("Internal/private URLs are not allowed");
  }
}

// ---------------------------------------------------------------------------
// GitHub helpers
// ---------------------------------------------------------------------------

/** Parse a GitHub URL or "org/repo" shorthand into owner + repo. */
export function parseOwnerRepo(raw: string): {
  owner: string;
  repo: string;
} {
  const shorthand = raw.match(/^([^/]+)\/([^/]+)$/);
  if (shorthand) {
    return { owner: shorthand[1], repo: shorthand[2] };
  }
  const urlMatch = raw.match(
    /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/.*)?$/,
  );
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2] };
  }
  throw new Error(
    "Could not parse GitHub owner/repo from URL. " +
      'Expected format: "https://github.com/org/repo" or "org/repo"',
  );
}

/** Fetch a path from the GitHub Contents API as JSON. Returns null on error. */
export async function fetchGitHubJson(
  owner: string,
  repo: string,
  path: string,
): Promise<unknown> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  validateUrl(url);
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "AgentNative/1.0",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });
  if (!res.ok) return null;
  return res.json();
}

/** Fetch raw file content from the GitHub Contents API. Returns null on error or oversize. */
export async function fetchGitHubRaw(
  owner: string,
  repo: string,
  path: string,
): Promise<string | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  validateUrl(url);
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3.raw",
      "User-Agent": "AgentNative/1.0",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });
  if (!res.ok) return null;

  const cl = res.headers.get("content-length");
  if (cl && parseInt(cl, 10) > MAX_FILE_SIZE) return null;

  const text = await res.text();
  if (text.length > MAX_FILE_SIZE) return null;
  return text;
}

// ---------------------------------------------------------------------------
// Tailwind config parser
// ---------------------------------------------------------------------------

/** Extract colors, fonts, spacing, borderRadius from a Tailwind config file string. */
export function parseTailwindConfig(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  const colorsMatch = content.match(
    /colors\s*:\s*(\{[\s\S]*?\n\s{4}\}|\{[^}]+\})/,
  );
  if (colorsMatch) {
    try {
      const colors: Record<string, string> = {};
      const pairs = colorsMatch[1].matchAll(
        /['"]?([\w-]+)['"]?\s*:\s*['"]([^'"]+)['"]/g,
      );
      for (const p of pairs) {
        colors[p[1]] = p[2];
      }
      if (Object.keys(colors).length > 0) result.colors = colors;
    } catch {
      // skip
    }
  }

  const fontMatch = content.match(
    /fontFamily\s*:\s*(\{[\s\S]*?\n\s{4}\}|\{[^}]+\})/,
  );
  if (fontMatch) {
    const fonts: Record<string, string> = {};
    const pairs = fontMatch[1].matchAll(
      /['"]?([\w-]+)['"]?\s*:\s*\[?\s*['"]([^'"]+)['"]/g,
    );
    for (const p of pairs) {
      fonts[p[1]] = p[2];
    }
    if (Object.keys(fonts).length > 0) result.fontFamily = fonts;
  }

  const spacingMatch = content.match(
    /spacing\s*:\s*(\{[\s\S]*?\n\s{4}\}|\{[^}]+\})/,
  );
  if (spacingMatch) {
    const spacing: Record<string, string> = {};
    const pairs = spacingMatch[1].matchAll(
      /['"]?([\w.-]+)['"]?\s*:\s*['"]([^'"]+)['"]/g,
    );
    for (const p of pairs) {
      spacing[p[1]] = p[2];
    }
    if (Object.keys(spacing).length > 0) result.spacing = spacing;
  }

  const radiusMatch = content.match(
    /borderRadius\s*:\s*(\{[\s\S]*?\n\s{4}\}|\{[^}]+\})/,
  );
  if (radiusMatch) {
    const radii: Record<string, string> = {};
    const pairs = radiusMatch[1].matchAll(
      /['"]?([\w-]+)['"]?\s*:\s*['"]([^'"]+)['"]/g,
    );
    for (const p of pairs) {
      radii[p[1]] = p[2];
    }
    if (Object.keys(radii).length > 0) result.borderRadius = radii;
  }

  return result;
}

// ---------------------------------------------------------------------------
// CSS parser
// ---------------------------------------------------------------------------

/** Extract CSS custom properties and @font-face / Google Fonts from CSS content. */
export function parseCss(content: string): ParsedCss {
  const cssCustomProperties: Record<string, string> = {};
  const varMatches = content.matchAll(/--([\w-]+)\s*:\s*([^;}\n]+)/g);
  for (const m of varMatches) {
    cssCustomProperties[`--${m[1]}`] = m[2].trim();
  }

  const fonts: string[] = [];
  const fontFaceMatches = content.matchAll(/@font-face\s*\{([^}]+)\}/g);
  for (const m of fontFaceMatches) {
    const familyMatch = m[1].match(/font-family\s*:\s*["']?([^"';]+)["']?/);
    if (familyMatch) fonts.push(familyMatch[1].trim());
  }

  const importMatches = content.matchAll(
    /@import\s+url\(\s*['"]?(fonts\.googleapis\.com[^'")\s]+)['"]?\s*\)/g,
  );
  for (const m of importMatches) {
    const familyParam = m[1].match(/family=([^&"')\s]+)/);
    if (familyParam) {
      fonts.push(decodeURIComponent(familyParam[1]).replace(/\+/g, " "));
    }
  }

  return {
    cssCustomProperties:
      Object.keys(cssCustomProperties).length > 0
        ? cssCustomProperties
        : undefined,
    fonts: fonts.length > 0 ? [...new Set(fonts)] : undefined,
  };
}

// ---------------------------------------------------------------------------
// Styling framework detection
// ---------------------------------------------------------------------------

/** Detect the styling framework from a package.json string. */
export function detectStylingFramework(content: string): string | undefined {
  try {
    const pkg = JSON.parse(content);
    const all = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
    if (all["tailwindcss"] || all["@tailwindcss/cli"]) return "tailwindcss";
    if (all["styled-components"]) return "styled-components";
    if (all["@emotion/react"] || all["@emotion/styled"]) return "emotion";
    if (all["sass"] || all["node-sass"]) return "sass";
    if (all["less"]) return "less";
    if (all["@vanilla-extract/css"]) return "vanilla-extract";
    if (all["windicss"]) return "windicss";
    if (all["unocss"]) return "unocss";
    return undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Code file analysis helpers (import-code)
// ---------------------------------------------------------------------------

/** Create a fresh state object for code file analysis. */
export function createCodeAnalysisState(): CodeAnalysisState {
  return {
    colors: {},
    cssCustomProperties: {},
    fonts: [],
    spacing: {},
    borderRadius: {},
    stylingFramework: null,
    rawExtracts: [],
    seenFonts: new Set<string>(),
  };
}

/** De-duplicate and add a font to the analysis state. */
export function addFont(
  state: CodeAnalysisState,
  family: string,
  source?: string,
): void {
  const normalized = family.trim().replace(/["']/g, "");
  if (!normalized || state.seenFonts.has(normalized.toLowerCase())) return;
  state.seenFonts.add(normalized.toLowerCase());
  state.fonts.push({ family: normalized, source });
}

/** Extract CSS custom properties, classifying them by name into colors/spacing/radius. */
export function extractCssVars(
  state: CodeAnalysisState,
  content: string,
): void {
  const pattern = /--([\w-]+)\s*:\s*([^;}\n]+)/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const name = `--${match[1]}`;
    const value = match[2].trim();
    state.cssCustomProperties[name] = value;

    if (
      /color|bg|background|text|border|accent|primary|secondary|surface|muted|foreground/i.test(
        match[1],
      )
    ) {
      state.colors[name] = value;
    } else if (/spacing|gap|padding|margin|space/i.test(match[1])) {
      state.spacing[name] = value;
    } else if (/radius|rounded/i.test(match[1])) {
      state.borderRadius[name] = value;
    }
  }
}

/** Extract literal color values (hex, rgb, hsl, oklch) from content. */
export function extractCodeColors(
  state: CodeAnalysisState,
  content: string,
): void {
  const hexPattern = /#[0-9a-fA-F]{3,8}\b/g;
  let m;
  while ((m = hexPattern.exec(content)) !== null) {
    state.colors[m[0]] = m[0];
  }

  const rgbPattern =
    /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+)?\s*\)/g;
  while ((m = rgbPattern.exec(content)) !== null) {
    state.colors[m[0]] = m[0];
  }

  const hslPattern =
    /hsla?\(\s*\d+\s*,\s*[\d.]+%\s*,\s*[\d.]+%(?:\s*,\s*[\d.]+)?\s*\)/g;
  while ((m = hslPattern.exec(content)) !== null) {
    state.colors[m[0]] = m[0];
  }

  const oklchPattern =
    /oklch\(\s*[\d.]+%?\s+[\d.]+\s+[\d.]+(?:\s*\/\s*[\d.]+)?\s*\)/g;
  while ((m = oklchPattern.exec(content)) !== null) {
    state.colors[m[0]] = m[0];
  }
}

/** Extract font-family declarations and @font-face blocks from CSS-like content. */
export function extractCodeFonts(
  state: CodeAnalysisState,
  content: string,
  filename: string,
): void {
  const fontFamilyPattern = /font-family\s*:\s*["']?([^"';}\n]+)/g;
  let m;
  while ((m = fontFamilyPattern.exec(content)) !== null) {
    const families = m[1].split(",");
    for (const fam of families) {
      const trimmed = fam.trim().replace(/["']/g, "");
      if (
        trimmed &&
        !/^(sans-serif|serif|monospace|cursive|fantasy|system-ui|inherit|initial)$/i.test(
          trimmed,
        )
      ) {
        addFont(state, trimmed, filename);
      }
    }
  }

  const fontFacePattern = /@font-face\s*\{([^}]+)\}/g;
  while ((m = fontFacePattern.exec(content)) !== null) {
    const block = m[1];
    const familyMatch = block.match(/font-family\s*:\s*["']?([^"';]+)["']?/);
    if (familyMatch) {
      addFont(state, familyMatch[1], filename);
    }
  }
}

/** Analyze a CSS/SCSS/LESS file, extracting vars, colors, and fonts. */
export function analyzeCssFile(
  state: CodeAnalysisState,
  content: string,
  filename: string,
): void {
  extractCssVars(state, content);
  extractCodeColors(state, content);
  extractCodeFonts(state, content, filename);
  state.rawExtracts.push({ filename, type: "css", data: { parsed: true } });
}

/** Analyze a Tailwind config file for tokens. */
export function analyzeTailwindConfig(
  state: CodeAnalysisState,
  content: string,
  filename: string,
): void {
  state.stylingFramework = "tailwind";

  const colorsBlockMatch = content.match(/colors\s*:\s*\{([\s\S]*?)\}/);
  if (colorsBlockMatch) {
    const pairPattern = /["']?([\w-]+)["']?\s*:\s*["']([^"']+)["']/g;
    let m;
    while ((m = pairPattern.exec(colorsBlockMatch[1])) !== null) {
      state.colors[m[1]] = m[2];
    }
  }

  const fontFamilyBlockMatch = content.match(/fontFamily\s*:\s*\{([\s\S]*?)\}/);
  if (fontFamilyBlockMatch) {
    const fontPairPattern = /["']?([\w-]+)["']?\s*:\s*\[?\s*["']([^"']+)["']/g;
    let m;
    while ((m = fontPairPattern.exec(fontFamilyBlockMatch[1])) !== null) {
      addFont(state, m[2], filename);
    }
  }

  const spacingBlockMatch = content.match(/spacing\s*:\s*\{([\s\S]*?)\}/);
  if (spacingBlockMatch) {
    const pairPattern = /["']?([\w.-]+)["']?\s*:\s*["']([^"']+)["']/g;
    let m;
    while ((m = pairPattern.exec(spacingBlockMatch[1])) !== null) {
      state.spacing[m[1]] = m[2];
    }
  }

  const radiusBlockMatch = content.match(/borderRadius\s*:\s*\{([\s\S]*?)\}/);
  if (radiusBlockMatch) {
    const pairPattern = /["']?([\w-]+)["']?\s*:\s*["']([^"']+)["']/g;
    let m;
    while ((m = pairPattern.exec(radiusBlockMatch[1])) !== null) {
      state.borderRadius[m[1]] = m[2];
    }
  }

  extractCodeColors(state, content);

  state.rawExtracts.push({
    filename,
    type: "tailwind-config",
    data: {
      hasColors: !!colorsBlockMatch,
      hasFontFamily: !!fontFamilyBlockMatch,
      hasSpacing: !!spacingBlockMatch,
      hasBorderRadius: !!radiusBlockMatch,
    },
  });
}

/** Walk a parsed JSON theme object, extracting tokens into state. */
export function analyzeJsonTheme(
  state: CodeAnalysisState,
  content: string,
  filename: string,
): void {
  try {
    const json = JSON.parse(content);
    const walk = (obj: Record<string, unknown>, prefix: string) => {
      for (const [key, value] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === "string") {
          const lower = key.toLowerCase();
          if (
            /color|bg|background|text|border|accent|primary|secondary|surface/i.test(
              lower,
            ) ||
            /^#[0-9a-fA-F]{3,8}$/.test(value)
          ) {
            state.colors[path] = value;
          } else if (/font|family|typeface/i.test(lower)) {
            addFont(state, value, filename);
          } else if (/spacing|gap|padding|margin|space/i.test(lower)) {
            state.spacing[path] = value;
          } else if (/radius|rounded/i.test(lower)) {
            state.borderRadius[path] = value;
          }
        } else if (
          value &&
          typeof value === "object" &&
          !Array.isArray(value)
        ) {
          walk(value as Record<string, unknown>, path);
        }
      }
    };
    walk(json, "");
    state.rawExtracts.push({
      filename,
      type: "json-theme",
      data: { keys: Object.keys(json) },
    });
  } catch {
    state.rawExtracts.push({
      filename,
      type: "json-theme",
      data: { parseError: true },
    });
  }
}

/** Analyze package.json for styling framework deps. */
export function analyzePackageJson(
  state: CodeAnalysisState,
  content: string,
  filename: string,
): void {
  try {
    const json = JSON.parse(content);
    const allDeps = {
      ...json.dependencies,
      ...json.devDependencies,
    };

    const detected: string[] = [];
    for (const fw of FRAMEWORK_DETECTORS) {
      if (allDeps && fw.name in allDeps) {
        detected.push(fw.label);
        if (!state.stylingFramework) {
          state.stylingFramework = fw.label;
        }
      }
    }

    state.rawExtracts.push({
      filename,
      type: "package-json",
      data: { stylingDeps: detected },
    });
  } catch {
    state.rawExtracts.push({
      filename,
      type: "package-json",
      data: { parseError: true },
    });
  }
}

/** Analyze a theme source file (theme.ts, tokens.ts) for design tokens. */
export function analyzeThemeSourceFile(
  state: CodeAnalysisState,
  content: string,
  filename: string,
): void {
  const namedHexPattern =
    /(?:const|let|var|export)\s+(\w+)\s*=\s*["']?(#[0-9a-fA-F]{3,8})\b/g;
  let m;
  while ((m = namedHexPattern.exec(content)) !== null) {
    state.colors[m[1]] = m[2];
  }

  const kvHexPattern = /["']?([\w-]+)["']?\s*:\s*["'](#[0-9a-fA-F]{3,8})["']/g;
  while ((m = kvHexPattern.exec(content)) !== null) {
    state.colors[m[1]] = m[2];
  }

  const fontStringPattern =
    /(?:font|family|typeface)\w*\s*[:=]\s*["']([^"']+)["']/gi;
  while ((m = fontStringPattern.exec(content)) !== null) {
    addFont(state, m[1], filename);
  }

  const spacingPattern =
    /(?:spacing|gap|padding|margin)\w*\s*[:=]\s*["']([^"']+)["']/gi;
  while ((m = spacingPattern.exec(content)) !== null) {
    state.spacing[m[0].split(/[:=]/)[0].trim()] = m[1];
  }

  extractCodeColors(state, content);

  state.rawExtracts.push({
    filename,
    type: "theme-source",
    data: { parsed: true },
  });
}

/** Route a file to the correct analyzer based on filename. */
export function analyzeCodeFile(
  state: CodeAnalysisState,
  filename: string,
  content: string,
): void {
  const name = filename.toLowerCase();
  const basename = name.split("/").pop() ?? name;

  if (basename.startsWith("tailwind.config")) {
    analyzeTailwindConfig(state, content, filename);
  } else if (basename === "package.json") {
    analyzePackageJson(state, content, filename);
  } else if (
    basename === "theme.json" ||
    basename === "tokens.json" ||
    basename.endsWith(".tokens.json")
  ) {
    analyzeJsonTheme(state, content, filename);
  } else if (name.endsWith(".css")) {
    analyzeCssFile(state, content, filename);
  } else if (
    /^theme\.(ts|js)$/.test(basename) ||
    /^tokens\.(ts|js)$/.test(basename)
  ) {
    analyzeThemeSourceFile(state, content, filename);
  } else if (
    name.endsWith(".ts") ||
    name.endsWith(".tsx") ||
    name.endsWith(".js") ||
    name.endsWith(".jsx")
  ) {
    extractCodeColors(state, content);
    extractCodeFonts(state, content, filename);
    extractCssVars(state, content);
    state.rawExtracts.push({
      filename,
      type: "source",
      data: { lightPass: true },
    });
  } else if (name.endsWith(".json")) {
    analyzeJsonTheme(state, content, filename);
  } else if (
    name.endsWith(".scss") ||
    name.endsWith(".sass") ||
    name.endsWith(".less")
  ) {
    analyzeCssFile(state, content, filename);
    if (!state.stylingFramework) {
      state.stylingFramework = name.endsWith(".less") ? "less" : "sass";
    }
  }
}

// ---------------------------------------------------------------------------
// Document analysis helpers (import-document)
// ---------------------------------------------------------------------------

/** Deduplicate and trim an array of strings. */
export function unique(arr: string[]): string[] {
  return [...new Set(arr.map((s) => s.trim()))];
}

/** Extract hex and named colors from plain text. */
export function extractDocumentColors(text: string): string[] {
  const hex = text.match(HEX_COLOR_RE) ?? [];
  const named = text.match(NAMED_COLOR_RE) ?? [];
  return unique([...hex, ...named.map((n) => n.toLowerCase())]);
}

/** Extract known font family names from plain text. */
export function extractDocumentFonts(text: string): string[] {
  const matches = text.match(FONT_NAME_RE) ?? [];
  return unique(matches);
}

/** Classify a file type string into a content category. */
export function classifyFile(fileType: string): ContentType {
  const ft = fileType.toLowerCase();
  if (
    ft.includes("pptx") ||
    ft.includes("ppt") ||
    ft.includes("presentation") ||
    ft.includes("keynote")
  )
    return "presentation";
  if (
    ft.includes("docx") ||
    ft.includes("doc") ||
    ft.includes("document") ||
    ft.includes("rtf")
  )
    return "document";
  if (
    ft.includes("xlsx") ||
    ft.includes("xls") ||
    ft.includes("spreadsheet") ||
    ft.includes("csv")
  )
    return "spreadsheet";
  if (ft.includes("pdf")) return "pdf";
  return "other";
}

/** Return per-type suggestions for how to use a document for design extraction. */
export function suggestionsForType(
  contentType: ContentType,
  hasText: boolean,
): string[] {
  const base: string[] = [];

  switch (contentType) {
    case "presentation":
      base.push(
        "Look for slide master/theme colors — these define the brand palette",
        "Check heading fonts on title slides for the brand typeface",
        "Note any accent colors used for callouts or highlights",
        "Slide backgrounds may reveal primary and secondary brand colors",
        "Chart/graph colors often match the brand accent palette",
      );
      break;
    case "document":
      base.push(
        "Heading styles reveal the typographic hierarchy and heading font",
        "Body text font is likely the primary readable typeface",
        "Look for colored headings or accent text for brand colors",
        "Document margins and spacing suggest preferred density",
        "Header/footer formatting may include brand colors or logos",
      );
      break;
    case "spreadsheet":
      base.push(
        "Header row colors often reflect the brand palette",
        "Conditional formatting colors may indicate status/accent colors",
        "Chart and graph colors are strong brand palette signals",
        "Cell background highlighting colors suggest accent palette",
      );
      break;
    case "pdf":
      base.push(
        "PDF may contain embedded brand guidelines or style specs",
        "Look for consistent heading colors and font choices",
        "Background colors and accent bars reveal brand palette",
      );
      break;
    case "other":
      base.push(
        "Examine any visual elements for recurring color patterns",
        "Note any typography that appears intentionally branded",
      );
      break;
  }

  if (!hasText) {
    base.push(
      "No text content was extracted — ask the user to paste key sections or send the file as a chat attachment for visual analysis",
    );
  }

  return base;
}

// ---------------------------------------------------------------------------
// URL scraping helpers (import-from-url)
// ---------------------------------------------------------------------------

/** Fetch and extract design tokens from a URL's HTML. */
export async function extractDesignTokensFromUrl(
  rawUrl: string,
): Promise<UrlExtractionResult> {
  const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
  validateUrl(url);

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; AgentNative/1.0; +https://agent-native.com)",
    },
    signal: AbortSignal.timeout(10000),
  });
  const html = await response.text();

  const result: UrlExtractionResult = { url };

  // Title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    result.pageTitle = titleMatch[1].trim();
  }

  // Meta description
  const descMatch = html.match(
    /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i,
  );
  if (descMatch) {
    result.metaDescription = descMatch[1];
  }

  // Meta theme-color
  const themeColorMatch = html.match(
    /<meta[^>]*name=["']theme-color["'][^>]*content=["']([^"']+)["']/i,
  );
  if (themeColorMatch) {
    result.themeColor = themeColorMatch[1];
  }

  // CSS custom properties
  const cssVarMatches = html.matchAll(/--([\w-]+)\s*:\s*([^;}\n]+)/g);
  const cssVars: Record<string, string> = {};
  for (const match of cssVarMatches) {
    cssVars[`--${match[1]}`] = match[2].trim();
  }
  if (Object.keys(cssVars).length > 0) {
    const entries = Object.entries(cssVars).slice(0, 50);
    result.cssCustomProperties = Object.fromEntries(entries);
  }

  // Inline colors (hex, rgb)
  const colorMatches = new Set<string>();
  const hexPattern = /#[0-9a-fA-F]{3,8}\b/g;
  let hexMatch;
  while ((hexMatch = hexPattern.exec(html)) !== null) {
    colorMatches.add(hexMatch[0]);
  }
  const rgbPattern =
    /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+)?\s*\)/g;
  let rgbMatch;
  while ((rgbMatch = rgbPattern.exec(html)) !== null) {
    colorMatches.add(rgbMatch[0]);
  }
  if (colorMatches.size > 0) {
    result.colors = [...colorMatches].slice(0, 30);
  }

  // @font-face
  const fontFaceMatches = html.matchAll(/@font-face\s*\{([^}]+)\}/g);
  const fonts: { family?: string; src?: string }[] = [];
  for (const match of fontFaceMatches) {
    const block = match[1];
    const familyMatch = block.match(/font-family\s*:\s*["']?([^"';]+)["']?/);
    const srcMatch = block.match(/src\s*:\s*([^;]+)/);
    fonts.push({
      family: familyMatch?.[1]?.trim(),
      src: srcMatch?.[1]?.trim()?.slice(0, 200),
    });
  }
  if (fonts.length > 0) {
    result.fontFaces = fonts.slice(0, 20);
  }

  // Google Fonts
  const googleFontMatches = html.matchAll(
    /fonts\.googleapis\.com\/css2?\?[^"'>\s]+/g,
  );
  const googleFonts: string[] = [];
  for (const match of googleFontMatches) {
    googleFonts.push(match[0]);
  }
  if (googleFonts.length > 0) {
    result.googleFonts = googleFonts;
  }

  // OG image
  const ogImageMatch = html.match(
    /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
  );
  if (ogImageMatch) {
    result.ogImage = ogImageMatch[1];
  }

  // Favicon
  const faviconMatch = html.match(
    /<link[^>]*rel=["'](?:icon|shortcut icon)["'][^>]*href=["']([^"']+)["']/i,
  );
  if (faviconMatch) {
    result.favicon = faviconMatch[1];
  }

  return result;
}
