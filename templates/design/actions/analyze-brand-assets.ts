import { defineAction } from "@agent-native/core";
import {
  normalizeBrandWebsiteUrl,
  fetchBrandWebsiteSignals,
} from "@agent-native/core/brand-kit";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js"; // ensure registerShareableResource runs

// Re-exported for back-compat with existing imports/tests.
export { normalizeBrandWebsiteUrl };

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
      result.websiteAnalysis = await fetchBrandWebsiteSignals(websiteUrl);
    }

    return result;
  },
});
