import { defineAction } from "@agent-native/core";
import { z } from "zod";

const MAX_FILES = 10;
const MAX_FILE_SIZE = 100 * 1024; // 100KB
const FETCH_TIMEOUT = 15000;

/** Patterns to search for design-related files at the repo root and secondary paths. */
const ROOT_PATTERNS = [
  /^tailwind\.config\.\w+$/,
  /^postcss\.config\.\w+$/,
  /^\.?theme\.\w+$/,
  /^\.?tokens\.\w+$/,
  /^package\.json$/,
  /\.css$/,
];

const SECONDARY_PATHS = [
  "src/styles",
  "styles",
  "src/theme",
  "app/globals.css",
  "src/globals.css",
  "src/index.css",
  "app/layout.tsx",
  "src/app/globals.css",
];

function parseOwnerRepo(raw: string): { owner: string; repo: string } {
  // Handle "org/repo" shorthand
  const shorthand = raw.match(/^([^/]+)\/([^/]+)$/);
  if (shorthand) {
    return { owner: shorthand[1], repo: shorthand[2] };
  }

  // Handle full GitHub URLs
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

function validateUrl(url: string): void {
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

async function fetchGitHubJson(
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

async function fetchGitHubRaw(
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

  // Check content-length if available; otherwise read and check
  const cl = res.headers.get("content-length");
  if (cl && parseInt(cl, 10) > MAX_FILE_SIZE) return null;

  const text = await res.text();
  if (text.length > MAX_FILE_SIZE) return null;
  return text;
}

/** Extract colors, fonts, spacing, borderRadius from a Tailwind config file. */
function parseTailwindConfig(content: string) {
  const result: Record<string, unknown> = {};

  // Extract theme.colors (object literal after "colors:")
  const colorsMatch = content.match(
    /colors\s*:\s*(\{[\s\S]*?\n\s{4}\}|\{[^}]+\})/,
  );
  if (colorsMatch) {
    try {
      // Attempt a rough key-value extraction from the object literal
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

  // Extract theme.fontFamily
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

  // Extract theme.spacing
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

  // Extract theme.borderRadius
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

/** Extract CSS custom properties and @font-face from CSS content. */
function parseCss(content: string) {
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

  // Also grab Google Fonts import URLs
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

/** Detect the styling framework from package.json. */
function detectStylingFramework(content: string): string | undefined {
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

export default defineAction({
  description:
    "Import design tokens from a public GitHub repository. " +
    "Reads Tailwind configs, CSS files, theme/token files, and package.json " +
    "to extract colors, fonts, spacing, and CSS custom properties.",
  schema: z.object({
    repoUrl: z
      .string()
      .describe(
        'GitHub repository URL (e.g. "https://github.com/org/repo" or "org/repo")',
      ),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ repoUrl }) => {
    const { owner, repo } = parseOwnerRepo(repoUrl.trim());

    // Validate the constructed API URL
    validateUrl(`https://api.github.com/repos/${owner}/${repo}`);

    const rawFiles: Record<string, string> = {};
    let fetchedCount = 0;

    async function collectFile(path: string): Promise<void> {
      if (fetchedCount >= MAX_FILES) return;
      const content = await fetchGitHubRaw(owner, repo, path);
      if (content) {
        rawFiles[path] = content;
        fetchedCount++;
      }
    }

    // 1. List repository root
    const rootListing = (await fetchGitHubJson(owner, repo, "")) as Array<{
      name: string;
      type: string;
      size?: number;
    }> | null;

    if (!rootListing || !Array.isArray(rootListing)) {
      throw new Error(
        `Could not list repository contents for ${owner}/${repo}. ` +
          "Ensure the repository is public and the URL is correct.",
      );
    }

    // 2. Fetch root-level files matching patterns
    const rootFilePromises: Promise<void>[] = [];
    for (const entry of rootListing) {
      if (entry.type !== "file") continue;
      if (entry.size && entry.size > MAX_FILE_SIZE) continue;
      const matches = ROOT_PATTERNS.some((p) => p.test(entry.name));
      if (matches && fetchedCount < MAX_FILES) {
        rootFilePromises.push(collectFile(entry.name));
      }
    }
    await Promise.all(rootFilePromises);

    // 3. Fetch secondary paths (files and directories)
    const secondaryPromises: Promise<void>[] = [];
    for (const path of SECONDARY_PATHS) {
      if (fetchedCount >= MAX_FILES) break;

      // If path looks like a file (has extension), fetch directly
      if (/\.\w+$/.test(path)) {
        secondaryPromises.push(collectFile(path));
      } else {
        // It's a directory -- list and collect CSS/theme/token files
        secondaryPromises.push(
          (async () => {
            const listing = (await fetchGitHubJson(
              owner,
              repo,
              path,
            )) as Array<{
              name: string;
              type: string;
              path: string;
              size?: number;
            }> | null;
            if (!listing || !Array.isArray(listing)) return;
            const innerPromises: Promise<void>[] = [];
            for (const entry of listing) {
              if (fetchedCount >= MAX_FILES) break;
              if (entry.type !== "file") continue;
              if (entry.size && entry.size > MAX_FILE_SIZE) continue;
              if (
                /\.(css|scss|less)$/.test(entry.name) ||
                /theme/i.test(entry.name) ||
                /tokens?/i.test(entry.name)
              ) {
                innerPromises.push(collectFile(entry.path));
              }
            }
            await Promise.all(innerPromises);
          })(),
        );
      }
    }
    await Promise.all(secondaryPromises);

    // 4. Parse collected files
    let colors: Record<string, unknown> = {};
    let fonts: string[] = [];
    let spacing: Record<string, string> = {};
    let borderRadius: Record<string, string> = {};
    let cssCustomProperties: Record<string, string> = {};
    let stylingFramework: string | undefined;

    for (const [filename, content] of Object.entries(rawFiles)) {
      // Tailwind config
      if (/tailwind\.config\.\w+$/.test(filename)) {
        const tw = parseTailwindConfig(content);
        if (tw.colors)
          colors = { ...colors, ...(tw.colors as Record<string, unknown>) };
        if (tw.fontFamily) {
          fonts.push(...Object.values(tw.fontFamily as Record<string, string>));
        }
        if (tw.spacing)
          spacing = { ...spacing, ...(tw.spacing as Record<string, string>) };
        if (tw.borderRadius) {
          borderRadius = {
            ...borderRadius,
            ...(tw.borderRadius as Record<string, string>),
          };
        }
      }

      // CSS files
      if (/\.(css|scss|less)$/.test(filename)) {
        const parsed = parseCss(content);
        if (parsed.cssCustomProperties) {
          cssCustomProperties = {
            ...cssCustomProperties,
            ...parsed.cssCustomProperties,
          };
        }
        if (parsed.fonts) fonts.push(...parsed.fonts);
      }

      // package.json
      if (filename === "package.json") {
        stylingFramework = detectStylingFramework(content);
      }
    }

    // Deduplicate fonts
    fonts = [...new Set(fonts)];

    // Extract color values from CSS custom properties that look like colors
    const colorVarPattern =
      /^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|oklch\(|color\()/;
    for (const [key, value] of Object.entries(cssCustomProperties)) {
      if (colorVarPattern.test(value.trim()) && !colors[key]) {
        colors[key] = value.trim();
      }
    }

    return {
      source: "github" as const,
      repoUrl: `https://github.com/${owner}/${repo}`,
      colors: Object.keys(colors).length > 0 ? colors : undefined,
      fonts: fonts.length > 0 ? fonts : undefined,
      spacing: Object.keys(spacing).length > 0 ? spacing : undefined,
      borderRadius:
        Object.keys(borderRadius).length > 0 ? borderRadius : undefined,
      cssCustomProperties:
        Object.keys(cssCustomProperties).length > 0
          ? cssCustomProperties
          : undefined,
      stylingFramework,
      rawFiles,
    };
  },
});
