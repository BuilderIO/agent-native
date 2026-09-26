
import { ssrfSafeFetch } from "../extensions/url-safety.js";


export const MAX_FILES = 10;

export const MAX_FILE_SIZE = 100 * 1024;

export const FETCH_TIMEOUT = 15000;

export const ROOT_PATTERNS: RegExp[] = [
  /^tailwind\.config\.\w+$/,
  /^postcss\.config\.\w+$/,
  /^\.?theme\.\w+$/,
  /^\.?tokens\.\w+$/,
  /^package\.json$/,
  /\.css$/,
];

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

export const CODE_MAX_FILES = 20;

export const CODE_MAX_TOTAL_BYTES = 500 * 1024;

export interface CodeAnalysisFile {
  filename: string;
  content: string;
}

export interface CodeAnalysisResult {
  source: "code";
  fileCount: number;
  filesAnalyzed: string[];
  colors: Record<string, string>;
  cssCustomProperties: Record<string, string>;
  fonts: CodeAnalysisState["fonts"];
  spacing: CodeAnalysisState["spacing"];
  borderRadius: CodeAnalysisState["borderRadius"];
  stylingFramework: CodeAnalysisState["stylingFramework"];
  rawExtracts: CodeAnalysisState["rawExtracts"];
}

export const HEX_COLOR_RE = /#(?:[0-9a-fA-F]{3,4}){1,2}\b/g;

export const NAMED_COLOR_RE =
  /\b(red|blue|green|yellow|orange|purple|pink|cyan|magenta|teal|navy|maroon|coral|salmon|gold|silver|gray|grey|indigo|violet|lime|olive|aqua|fuchsia|crimson|turquoise|ivory|beige|lavender|tan|khaki|plum|orchid|sienna)\b/gi;

export const FONT_NAME_RE =
  /\b(Helvetica|Arial|Times New Roman|Georgia|Garamond|Futura|Bodoni|Avenir|Proxima Nova|Montserrat|Open Sans|Lato|Poppins|Raleway|Playfair Display|Merriweather|Source Sans|Noto Sans|Work Sans|Nunito|Rubik|Oswald|Roboto|Inter|DM Sans|Space Grotesk|SF Pro|Segoe UI|Calibri|Cambria|Century Gothic|Franklin Gothic|Gill Sans|Fira Sans|Barlow|Manrope|Sora|Plus Jakarta Sans|IBM Plex Sans|IBM Plex Serif|Libre Baskerville|Cormorant|Crimson Text)\b/gi;

export const COLOR_VAR_PATTERN =
  /^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|oklch\(|color\()/;

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
  stylesheetUrls?: string[];
  stylesheetFailures?: { url: string; error: string }[];
}

export interface GitHubFetchOptions {
  token?: string | null;
  ref?: string;
}

export interface GitHubRepoReference {
  owner: string;
  repo: string;
  ref?: string;
  subpath?: string;
}

export interface GitHubJsonResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  message?: string;
}


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


export function parseGitHubRepoReference(raw: string): GitHubRepoReference {
  const cleaned = raw
    .trim()
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
  if (!cleaned) throw new Error("GitHub repository reference cannot be empty.");

  const sshMatch = cleaned.match(
    /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/,
  );
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  const shorthand = cleaned.match(/^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (shorthand) return { owner: shorthand[1], repo: shorthand[2] };

  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    throw new Error(
      "Could not parse GitHub owner/repo from URL. " +
        'Expected format: "https://github.com/org/repo", "org/repo", or "git@github.com:org/repo.git"',
    );
  }
  if (parsed.hostname.toLowerCase() !== "github.com") {
    throw new Error("GitHub repository URL must use github.com.");
  }

  const parts = parsed.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
  const owner = parts[0];
  const repo = parts[1]?.replace(/\.git$/, "");
  if (!owner || !repo) {
    throw new Error(
      "Could not parse GitHub owner/repo from URL. " +
        'Expected format: "https://github.com/org/repo", "org/repo", or "git@github.com:org/repo.git"',
    );
  }

  const kind = parts[2];
  if ((kind === "tree" || kind === "blob") && parts[3]) {
    return {
      owner,
      repo,
      ref: parts[3],
      ...(parts.length > 4 ? { subpath: parts.slice(4).join("/") } : {}),
    };
  }
  return { owner, repo };
}

export function parseOwnerRepo(raw: string): { owner: string; repo: string } {
  const { owner, repo } = parseGitHubRepoReference(raw);
  return { owner, repo };
}

export function canonicalGitHubRepoUrl(raw: string): string {
  const { owner, repo } = parseGitHubRepoReference(raw);
  return `https://github.com/${owner}/${repo}`;
}

function githubContentsUrl(
  owner: string,
  repo: string,
  path: string,
  ref?: string,
): URL {
  const encodedPath = path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = new URL(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`,
  );
  if (ref?.trim()) url.searchParams.set("ref", ref.trim());
  return url;
}

function githubHeaders(
  accept: string,
  options: GitHubFetchOptions = {},
): Record<string, string> {
  return {
    Accept: accept,
    "User-Agent": "AgentNative/1.0",
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
  };
}

export async function fetchGitHubJsonResult<T = unknown>(
  owner: string,
  repo: string,
  path: string,
  options: GitHubFetchOptions = {},
): Promise<GitHubJsonResult<T>> {
  const url = githubContentsUrl(owner, repo, path, options.ref);
  validateUrl(url.toString());
  const res = await ssrfSafeFetch(url.toString(), {
    headers: githubHeaders("application/vnd.github.v3+json", options),
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });
  if (!res.ok) {
    let message: string | undefined;
    try {
      const body = (await res.json()) as { message?: unknown };
      if (typeof body.message === "string") message = body.message;
    } catch {
      try {
        const text = await res.text();
        if (text) message = text.slice(0, 200);
      } catch {
        // Keep the status-only result.
      }
    }
    return { ok: false, status: res.status, data: null, message };
  }
  return { ok: true, status: res.status, data: (await res.json()) as T };
}

export async function fetchGitHubJson(
  owner: string,
  repo: string,
  path: string,
  options: GitHubFetchOptions = {},
): Promise<unknown> {
  const result = await fetchGitHubJsonResult(owner, repo, path, options);
  return result.ok ? result.data : null;
}

export async function fetchGitHubRaw(
  owner: string,
  repo: string,
  path: string,
  options: GitHubFetchOptions = {},
): Promise<string | null> {
  const url = githubContentsUrl(owner, repo, path, options.ref);
  validateUrl(url.toString());
  const res = await ssrfSafeFetch(url.toString(), {
    headers: githubHeaders("application/vnd.github.v3.raw", options),
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });
  if (!res.ok) return null;

  const cl = res.headers.get("content-length");
  if (cl && parseInt(cl, 10) > MAX_FILE_SIZE) return null;

  const text = await res.text();
  if (text.length > MAX_FILE_SIZE) return null;
  return text;
}


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

export function analyzeCodeFiles(
  files: CodeAnalysisFile[],
): CodeAnalysisResult {
  const truncated = files.slice(0, CODE_MAX_FILES);
  let totalBytes = 0;
  const accepted: CodeAnalysisFile[] = [];
  for (const file of truncated) {
    const size = new TextEncoder().encode(file.content).byteLength;
    if (totalBytes + size > CODE_MAX_TOTAL_BYTES) break;
    totalBytes += size;
    accepted.push(file);
  }

  const state = createCodeAnalysisState();
  const filesAnalyzed: string[] = [];
  for (const file of accepted) {
    filesAnalyzed.push(file.filename);
    analyzeCodeFile(state, file.filename, file.content);
  }

  return {
    source: "code",
    fileCount: accepted.length,
    filesAnalyzed,
    colors: Object.fromEntries(Object.entries(state.colors).slice(0, 60)),
    cssCustomProperties: Object.fromEntries(
      Object.entries(state.cssCustomProperties).slice(0, 80),
    ),
    fonts: state.fonts.slice(0, 20),
    spacing: state.spacing,
    borderRadius: state.borderRadius,
    stylingFramework: state.stylingFramework,
    rawExtracts: state.rawExtracts,
  };
}


export function unique(arr: string[]): string[] {
  return [...new Set(arr.map((s) => s.trim()))];
}

export function extractDocumentColors(text: string): string[] {
  const hex = text.match(HEX_COLOR_RE) ?? [];
  const named = text.match(NAMED_COLOR_RE) ?? [];
  return unique([...hex, ...named.map((n) => n.toLowerCase())]);
}

export function extractDocumentFonts(text: string): string[] {
  const matches = text.match(FONT_NAME_RE) ?? [];
  return unique(matches);
}

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


const URL_FETCH_TIMEOUT = 10_000;
const MAX_URL_HTML_CHARS = 1_000_000;
const MAX_URL_STYLESHEETS = 10;
const MAX_URL_STYLESHEET_CHARS = 256 * 1024;
const MAX_URL_STYLESHEET_TOTAL_CHARS = 512 * 1024;

interface FetchedStylesheet {
  url: string;
  content: string;
}

interface StylesheetFetchResult {
  fetched: FetchedStylesheet[];
  urls: string[];
  failures: { url: string; error: string }[];
}

function normalizeUrlInput(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) throw new Error("Website URL is required");
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  return new URL(candidate).href;
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function readHtmlAttribute(tag: string, attribute: string): string | undefined {
  const match = tag.match(
    new RegExp(
      `\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
      "i",
    ),
  );
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value === undefined ? undefined : decodeHtmlAttribute(value.trim());
}

function resolveHttpUrl(
  value: string | undefined,
  baseUrl: string,
):
  | { kind: "missing" }
  | { kind: "resolved"; url: string }
  | { kind: "invalid"; value: string } {
  if (!value) return { kind: "missing" };
  try {
    const parsed = new URL(value, baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { kind: "missing" };
    }
    return { kind: "resolved", url: parsed.href };
  } catch {
    return { kind: "invalid", value };
  }
}

function readMetaContent(
  html: string,
  attribute: string,
  value: string,
): string | undefined {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    if (readHtmlAttribute(tag, attribute)?.toLowerCase() !== value) continue;
    const content = readHtmlAttribute(tag, "content");
    if (content !== undefined) return content;
  }
  return undefined;
}

function extractStylesheetUrls(html: string, baseUrl: string): string[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = readHtmlAttribute(tag, "rel");
    if (
      !rel?.split(/\s+/).some((token) => token.toLowerCase() === "stylesheet")
    ) {
      continue;
    }
    const resolved = resolveHttpUrl(readHtmlAttribute(tag, "href"), baseUrl);
    if (resolved.kind === "resolved") urls.add(resolved.url);
  }
  return [...urls];
}

function extractInlineCss(html: string): string {
  const parts: string[] = [];
  for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    parts.push(match[1]);
  }
  for (const match of html.matchAll(/<[a-z][^>]*>/gi)) {
    const style = readHtmlAttribute(match[0], "style");
    if (style) parts.push(style);
  }
  return parts.join("\n");
}

function extractFontFaces(
  content: string,
): { family?: string; src?: string }[] {
  const fonts: { family?: string; src?: string }[] = [];
  for (const match of content.matchAll(/@font-face\s*\{([^}]+)\}/g)) {
    const block = match[1];
    const familyMatch = block.match(/font-family\s*:\s*["']?([^"';]+)/);
    const srcMatch = block.match(/src\s*:\s*([^;]+)/);
    fonts.push({
      family: familyMatch?.[1]?.trim(),
      src: srcMatch?.[1]?.trim()?.slice(0, 200),
    });
  }
  return fonts;
}

function extractGoogleFontUrls(content: string): string[] {
  return [
    ...content.matchAll(/fonts\.googleapis\.com\/css2?\?[^"'>\s)]+/g),
  ].map((match) => match[0]);
}

function addColorMatches(content: string, colors: Set<string>): void {
  for (const match of content.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    colors.add(match[0]);
  }
  for (const match of content.matchAll(
    /\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([^)]*\)/gi,
  )) {
    colors.add(match[0]);
  }
}

async function readBoundedResponseText(
  response: Response,
  maxChars: number,
  label: string,
): Promise<string> {
  const contentLength = Number.parseInt(
    response.headers.get("content-length") ?? "",
    10,
  );
  if (Number.isFinite(contentLength) && contentLength > maxChars) {
    throw new Error(`${label} exceeds the ${maxChars}-character limit`);
  }

  if (!response.body) {
    const text = await response.text();
    if (text.length > maxChars) {
      throw new Error(`${label} exceeds the ${maxChars}-character limit`);
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        text += decoder.decode();
        break;
      }
      text += decoder.decode(chunk.value, { stream: true });
      if (text.length > maxChars) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`${label} exceeds the ${maxChars}-character limit`);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return text;
}

async function fetchStylesheets(
  pageUrl: string,
  html: string,
): Promise<StylesheetFetchResult> {
  const discovered = extractStylesheetUrls(html, pageUrl);
  const fetched: FetchedStylesheet[] = [];
  const urls: string[] = [];
  const failures: { url: string; error: string }[] = [];
  let totalChars = 0;

  for (const stylesheetUrl of discovered.slice(0, MAX_URL_STYLESHEETS)) {
    if (totalChars >= MAX_URL_STYLESHEET_TOTAL_CHARS) {
      failures.push({
        url: stylesheetUrl,
        error: `Skipped because the ${MAX_URL_STYLESHEET_TOTAL_CHARS}-character stylesheet budget was reached`,
      });
      continue;
    }

    try {
      const response = await ssrfSafeFetch(
        stylesheetUrl,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; AgentNative/1.0; +https://agent-native.com)",
          },
          signal: AbortSignal.timeout(URL_FETCH_TIMEOUT),
        },
        { maxRedirects: 3 },
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const remainingChars = MAX_URL_STYLESHEET_TOTAL_CHARS - totalChars;
      const content = await readBoundedResponseText(
        response,
        Math.min(MAX_URL_STYLESHEET_CHARS, remainingChars),
        `Stylesheet ${stylesheetUrl}`,
      );
      totalChars += content.length;
      fetched.push({ url: stylesheetUrl, content });
      urls.push(stylesheetUrl);
    } catch (error) {
      failures.push({
        url: stylesheetUrl,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (discovered.length > MAX_URL_STYLESHEETS) {
    failures.push({
      url: pageUrl,
      error: `Skipped ${discovered.length - MAX_URL_STYLESHEETS} stylesheet(s) after the ${MAX_URL_STYLESHEETS}-stylesheet limit`,
    });
  }

  return { fetched, urls, failures };
}

export async function extractDesignTokensFromUrl(
  rawUrl: string,
): Promise<UrlExtractionResult> {
  const url = normalizeUrlInput(rawUrl);
  validateUrl(url);

  const response = await ssrfSafeFetch(
    url,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AgentNative/1.0; +https://agent-native.com)",
      },
      signal: AbortSignal.timeout(URL_FETCH_TIMEOUT),
    },
    { maxRedirects: 3 },
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  const html = await readBoundedResponseText(
    response,
    MAX_URL_HTML_CHARS,
    `Website ${url}`,
  );
  const pageUrl = response.url || url;

  const result: UrlExtractionResult = { url };

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    result.pageTitle = titleMatch[1].trim();
  }

  const metaDescription = readMetaContent(html, "name", "description");
  if (metaDescription !== undefined) {
    result.metaDescription = metaDescription;
  }
  const themeColor = readMetaContent(html, "name", "theme-color");
  if (themeColor !== undefined) {
    result.themeColor = themeColor;
  }

  const inlineCss = extractInlineCss(html);
  const pageCss = parseCss(inlineCss);
  const stylesheetResult = await fetchStylesheets(pageUrl, html);
  const stylesheetCssVars: Record<string, string> = {};
  const fonts = extractFontFaces(inlineCss);
  const googleFonts = new Set(extractGoogleFontUrls(html));
  const colorMatches = new Set<string>();
  addColorMatches(html, colorMatches);

  for (const stylesheet of stylesheetResult.fetched) {
    const parsed = parseCss(stylesheet.content);
    Object.assign(stylesheetCssVars, parsed.cssCustomProperties);
    fonts.push(...extractFontFaces(stylesheet.content));
    for (const fontUrl of extractGoogleFontUrls(stylesheet.content)) {
      googleFonts.add(fontUrl);
    }
    addColorMatches(stylesheet.content, colorMatches);
  }

  const cssVars = {
    ...stylesheetCssVars,
    ...(pageCss.cssCustomProperties ?? {}),
  };
  if (Object.keys(cssVars).length > 0) {
    const entries = Object.entries(cssVars).slice(0, 50);
    result.cssCustomProperties = Object.fromEntries(entries);
  }

  if (colorMatches.size > 0) {
    result.colors = [...colorMatches].slice(0, 30);
  }

  if (fonts.length > 0) {
    const seenFonts = new Set<string>();
    result.fontFaces = fonts
      .filter((font) => {
        const key = `${font.family ?? ""}\u0000${font.src ?? ""}`;
        if (seenFonts.has(key)) return false;
        seenFonts.add(key);
        return true;
      })
      .slice(0, 20);
  }

  if (googleFonts.size > 0) {
    result.googleFonts = [...googleFonts];
  }

  const ogImage = readMetaContent(html, "property", "og:image");
  if (ogImage) {
    const resolved = resolveHttpUrl(ogImage, pageUrl);
    result.ogImage = resolved.kind === "resolved" ? resolved.url : ogImage;
  }

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = readHtmlAttribute(tag, "rel");
    if (!rel?.split(/\s+/).some((token) => token.toLowerCase() === "icon")) {
      continue;
    }
    const href = readHtmlAttribute(tag, "href");
    if (href && !/^data:/i.test(href)) {
      const resolved = resolveHttpUrl(href, pageUrl);
      result.favicon = resolved.kind === "resolved" ? resolved.url : href;
    }
    break;
  }

  if (stylesheetResult.urls.length > 0) {
    result.stylesheetUrls = stylesheetResult.urls;
  }
  if (stylesheetResult.failures.length > 0) {
    result.stylesheetFailures = stylesheetResult.failures;
  }

  return result;
}
