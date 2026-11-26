import { defineAction } from "@agent-native/core/action";
import { buildBrandAnalysisResult } from "@agent-native/core/brand-kit";
import { extractRenderedDesignSystemFromUrl } from "@agent-native/creative-context/connectors";
import { z } from "zod";

import "../server/db/index.js";

export default defineAction({
  description:
    "Gather brand data from various sources for agent analysis. " +
    "If a websiteUrl is provided, renders the page in a real browser and extracts " +
    "computed colors, typography, spacing, radii, shadows, component styles, " +
    "CSS custom properties, logo references, and a design.md-style summary. " +
    "Returns structured data the agent can use to build or refine a design.",
  schema: z.object({
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
  run: async ({ companyName, brandNotes, websiteUrl }) => {
    const websiteAnalysis = websiteUrl
      ? await extractRenderedDesignSystemFromUrl(websiteUrl)
      : undefined;

    return buildBrandAnalysisResult({
      companyName,
      brandNotes,
      websiteAnalysis,
    });
  },
});
