/**
 * Pure brand-signal extraction from a website's HTML.
 *
 * Shared by the `analyze-brand-assets` action across templates. DB-agnostic and
 * framework-agnostic: it only fetches (through the SSRF-safe helper) and parses
 * HTML. The DB access (resolving an existing Brand Kit) stays in the template's
 * thin action wrapper.
 */

import { ssrfSafeFetch } from "../extensions/url-safety.js";
import type { BrandWebsiteSignals } from "./types.js";

/**
 * Normalize a user-supplied brand website URL: add an `https://` scheme when
 * missing and reject anything that isn't http(s). Throws on empty input or an
 * unsupported scheme.
 */
export function normalizeBrandWebsiteUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Website URL is required");

  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  const parsed = new URL(candidate);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed");
  }
  return parsed.href;
}

/**
 * Parse brand signals out of a page's HTML: meta theme-color, CSS custom
 * properties (capped), @font-face declarations (capped), title, and meta
 * description. Pure — no network. The provided `url` is echoed back.
 */
export function extractBrandSignalsFromHtml(
  html: string,
  url: string,
): BrandWebsiteSignals {
  const extracted: BrandWebsiteSignals = { url };

  // Extract meta theme-color
  const themeColorMatch = html.match(
    /<meta[^>]*name=["']theme-color["'][^>]*content=["']([^"']+)["']/i,
  );
  if (themeColorMatch) {
    extracted.themeColor = themeColorMatch[1];
  }

  // Extract CSS custom properties (--var-name: value)
  const cssVarMatches = html.matchAll(/--([\w-]+)\s*:\s*([^;}\n]+)/g);
  const cssVars: Record<string, string> = {};
  for (const match of cssVarMatches) {
    cssVars[`--${match[1]}`] = match[2].trim();
  }
  if (Object.keys(cssVars).length > 0) {
    // Limit to first 50 to avoid overwhelming output
    const entries = Object.entries(cssVars).slice(0, 50);
    extracted.cssCustomProperties = Object.fromEntries(entries);
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
    extracted.fontFaces = fonts.slice(0, 20);
  }

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    extracted.pageTitle = titleMatch[1].trim();
  }

  // Extract meta description
  const descMatch = html.match(
    /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i,
  );
  if (descMatch) {
    extracted.metaDescription = descMatch[1];
  }

  return extracted;
}

/**
 * Fetch a brand website (SSRF-safe) and extract its brand signals. Returns the
 * parsed signals, or an `{ url, error }` shape if the fetch/parse fails — the
 * caller decides how to surface that to the agent.
 */
export async function fetchBrandWebsiteSignals(
  websiteUrl: string,
): Promise<BrandWebsiteSignals | { url: string; error: string }> {
  try {
    const url = normalizeBrandWebsiteUrl(websiteUrl);
    const response = await ssrfSafeFetch(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; AgentNative/1.0; +https://agent-native.com)",
        },
        signal: AbortSignal.timeout(10000),
      },
      { maxRedirects: 3 },
    );
    const html = await response.text();
    return extractBrandSignalsFromHtml(html, url);
  } catch (err) {
    return {
      url: websiteUrl,
      error: `Failed to fetch: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
