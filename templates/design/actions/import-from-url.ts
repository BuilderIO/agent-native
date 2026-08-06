import { defineAction } from "@agent-native/core";
import { extractRenderedDesignSystemFromUrl } from "@agent-native/creative-context/server";
import { z } from "zod";

export default defineAction({
  description:
    "Analyze a website URL with an SSRF-safe bounded extractor and return a design.md-style " +
    "visual system: computed colors, typography, spacing, radii, shadows, " +
    "component styles, CSS variables, logo references, and reusable Brand Kit data. " +
    "Uses static SSRF-safe extraction until Chromium navigation has a connect-time SSRF guard.",
  schema: z.object({
    url: z.string().describe("Website URL to analyze"),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ url }) => {
    return extractRenderedDesignSystemFromUrl(url);
  },
});
