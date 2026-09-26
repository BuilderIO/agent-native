
import { ssrfSafeFetch } from "../extensions/url-safety.js";
import type { BrandWebsiteSignals } from "./types.js";

export interface BrandAnalysisResult {
  companyName?: string;
  brandNotes?: string;
  existingDesignSystem?: unknown;
  websiteAnalysis?: unknown;
}

export function buildBrandAnalysisResult(input: {
  companyName?: string;
  brandNotes?: string;
  existingDesignSystem?: unknown;
  websiteAnalysis?: unknown;
}): BrandAnalysisResult {
  const result: BrandAnalysisResult = {};
  if (input.companyName) result.companyName = input.companyName;
  if (input.brandNotes) result.brandNotes = input.brandNotes;
  if (input.existingDesignSystem !== undefined) {
    result.existingDesignSystem = input.existingDesignSystem;
  }
  if (input.websiteAnalysis !== undefined) {
    result.websiteAnalysis = input.websiteAnalysis;
  }
  return result;
}

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

export function extractBrandSignalsFromHtml(
  html: string,
  url: string,
): BrandWebsiteSignals {
  const extracted: BrandWebsiteSignals = { url };

  const themeColorMatch = html.match(
    /<meta[^>]*name=["']theme-color["'][^>]*content=["']([^"']+)["']/i,
  );
  if (themeColorMatch) {
    extracted.themeColor = themeColorMatch[1];
  }

  const cssVarMatches = html.matchAll(/--([\w-]+)\s*:\s*([^;}\n]+)/g);
  const cssVars: Record<string, string> = {};
  for (const match of cssVarMatches) {
    cssVars[`--${match[1]}`] = match[2].trim();
  }
  if (Object.keys(cssVars).length > 0) {
    const entries = Object.entries(cssVars).slice(0, 50);
    extracted.cssCustomProperties = Object.fromEntries(entries);
  }

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

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    extracted.pageTitle = titleMatch[1].trim();
  }

  const descMatch = html.match(
    /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i,
  );
  if (descMatch) {
    extracted.metaDescription = descMatch[1];
  }

  return extracted;
}

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
