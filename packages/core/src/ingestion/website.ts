import { extractCssColors, rankColorSamples } from "./media.js";

export interface WebsiteAsset {
  url: string;
  kind: "image" | "video" | "audio" | "font" | "stylesheet" | "script";
  role?: "logo" | "open-graph";
}

export interface WebsiteDesignTokens {
  colors: string[];
  typography: Array<{
    family: string;
    size: string;
    weight: string;
    lineHeight: string;
    letterSpacing: string;
  }>;
  spacing: string[];
  radii: string[];
  cssVariables: Record<string, string>;
}

export interface WebsiteExtraction {
  title: string;
  text: string;
  assets: WebsiteAsset[];
  internalLinks: string[];
  designTokens: WebsiteDesignTokens;
}

export function extractStaticWebsiteContext(
  html: string,
  baseUrl: string,
): WebsiteExtraction {
  const title = decodeEntities(
    html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "",
  ).trim();
  const assets = new Map<string, WebsiteAsset>();
  const links = new Set<string>();
  for (const match of html.matchAll(
    /<(img|video|audio|script|link)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/gi,
  )) {
    const tag = match[1].toLowerCase();
    const url = resolveUrl(match[2], baseUrl);
    if (!url) continue;
    const kind =
      tag === "link"
        ? /icon/i.test(match[0])
          ? "image"
          : /font/i.test(match[0])
            ? "font"
            : "stylesheet"
        : tag === "img"
          ? "image"
          : tag;
    if (
      (
        ["image", "video", "audio", "font", "stylesheet", "script"] as string[]
      ).includes(kind)
    ) {
      const role =
        /(?:alt|class|id|rel)=["'][^"']*(?:logo|wordmark|brandmark|icon)[^"']*["']/i.test(
          match[0],
        )
          ? "logo"
          : undefined;
      assets.set(url, {
        url,
        kind: kind as WebsiteAsset["kind"],
        ...(role ? { role } : {}),
      });
    }
  }
  for (const match of html.matchAll(
    /<meta\b[^>]*(?:property|name)=["'](?:og:image(?::url)?|twitter:image)["'][^>]*content=["']([^"']+)["'][^>]*>|<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image(?::url)?|twitter:image)["'][^>]*>/gi,
  )) {
    const url = resolveUrl(match[1] ?? match[2], baseUrl);
    if (url) assets.set(url, { url, kind: "image", role: "open-graph" });
  }
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    const url = resolveUrl(match[1], baseUrl);
    if (url && new URL(url).origin === new URL(baseUrl).origin) links.add(url);
  }
  const styleText = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1])
    .join("\n");
  const cssVariables = Object.fromEntries(
    [...styleText.matchAll(/(--[\w-]+)\s*:\s*([^;}{]+)/g)].map((match) => [
      match[1],
      match[2].trim(),
    ]),
  );
  return {
    title,
    text: htmlToText(html),
    assets: [...assets.values()],
    internalLinks: [...links],
    designTokens: {
      colors: rankColorSamples(extractCssColors(styleText)),
      typography: [],
      spacing: uniqueMatches(
        styleText,
        /(?:margin|padding|gap)\s*:\s*([^;}{]+)/gi,
      ),
      radii: uniqueMatches(styleText, /border-radius\s*:\s*([^;}{]+)/gi),
      cssVariables,
    },
  };
}

function uniqueMatches(value: string, pattern: RegExp): string[] {
  return [
    ...new Set([...value.matchAll(pattern)].map((match) => match[1].trim())),
  ].slice(0, 100);
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\s*br\s*\/?\s*>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|section|article|main)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function resolveUrl(value: string, baseUrl: string): string | null {
  try {
    const url = new URL(decodeEntities(value), baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}
