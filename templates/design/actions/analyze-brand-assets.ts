import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { resolveAccess } from "@agent-native/core/sharing";
import "../server/db/index.js"; // ensure registerShareableResource runs

export default defineAction({
  description:
    "Gather brand data from various sources for agent analysis. " +
    "If a websiteUrl is provided, fetches the page HTML and extracts: " +
    "meta theme-color, CSS custom properties, font-face declarations. " +
    "If a designSystemId is provided, includes its existing data. " +
    "Returns structured data the agent can use to build or refine a design system.",
  schema: z.object({
    designSystemId: z
      .string()
      .optional()
      .describe("Existing design system ID to include its data"),
    companyName: z.string().optional().describe("Company or brand name"),
    brandNotes: z
      .string()
      .optional()
      .describe("Free-form notes about the brand style"),
    websiteUrl: z
      .string()
      .optional()
      .describe("URL to fetch and extract brand signals from"),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ designSystemId, companyName, brandNotes, websiteUrl }) => {
    const result: Record<string, unknown> = {};

    if (companyName) {
      result.companyName = companyName;
    }
    if (brandNotes) {
      result.brandNotes = brandNotes;
    }

    // Include existing design system data if provided
    if (designSystemId) {
      const access = await resolveAccess("design-system", designSystemId);
      if (access) {
        const row = access.resource;
        result.existingDesignSystem = {
          id: row.id,
          title: row.title,
          data: row.data ? JSON.parse(row.data) : null,
          assets: row.assets ? JSON.parse(row.assets) : null,
        };
      }
    }

    // Fetch and analyze website if URL provided
    if (websiteUrl) {
      try {
        const url = websiteUrl.startsWith("http")
          ? websiteUrl
          : `https://${websiteUrl}`;

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

        const extracted: Record<string, unknown> = { url };

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
          const familyMatch = block.match(
            /font-family\s*:\s*["']?([^"';]+)["']?/,
          );
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

        result.websiteAnalysis = extracted;
      } catch (err) {
        result.websiteAnalysis = {
          url: websiteUrl,
          error: `Failed to fetch: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    return result;
  },
});
