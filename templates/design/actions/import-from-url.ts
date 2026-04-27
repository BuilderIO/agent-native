import { defineAction } from "@agent-native/core";
import { z } from "zod";

export default defineAction({
  description:
    "Analyze a website URL to extract design tokens (colors, fonts, metadata) " +
    "for use in creating or updating a design project. " +
    "Returns extracted CSS variables, font faces, colors, and meta information.",
  schema: z.object({
    url: z.string().describe("Website URL to analyze"),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ url: rawUrl }) => {
    const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;

    // SSRF guard: only allow http/https and block internal/private IPs
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

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AgentNative/1.0; +https://agent-native.com)",
      },
      signal: AbortSignal.timeout(10000),
    });
    const html = await response.text();

    const result: Record<string, unknown> = { url };

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      result.pageTitle = titleMatch[1].trim();
    }

    // Extract meta description
    const descMatch = html.match(
      /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i,
    );
    if (descMatch) {
      result.metaDescription = descMatch[1];
    }

    // Extract meta theme-color
    const themeColorMatch = html.match(
      /<meta[^>]*name=["']theme-color["'][^>]*content=["']([^"']+)["']/i,
    );
    if (themeColorMatch) {
      result.themeColor = themeColorMatch[1];
    }

    // Extract CSS custom properties (--var-name: value)
    const cssVarMatches = html.matchAll(/--([\w-]+)\s*:\s*([^;}\n]+)/g);
    const cssVars: Record<string, string> = {};
    for (const match of cssVarMatches) {
      cssVars[`--${match[1]}`] = match[2].trim();
    }
    if (Object.keys(cssVars).length > 0) {
      const entries = Object.entries(cssVars).slice(0, 50);
      result.cssCustomProperties = Object.fromEntries(entries);
    }

    // Extract inline color values (hex, rgb, hsl)
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

    // Extract @font-face declarations
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

    // Extract Google Fonts links
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

    // Extract OG image
    const ogImageMatch = html.match(
      /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
    );
    if (ogImageMatch) {
      result.ogImage = ogImageMatch[1];
    }

    // Extract favicon
    const faviconMatch = html.match(
      /<link[^>]*rel=["'](?:icon|shortcut icon)["'][^>]*href=["']([^"']+)["']/i,
    );
    if (faviconMatch) {
      result.favicon = faviconMatch[1];
    }

    return result;
  },
});
