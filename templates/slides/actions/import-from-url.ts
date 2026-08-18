import { defineAction } from "@agent-native/core";
import { extractRenderedDesignSystemFromUrl } from "@agent-native/creative-context/server";
import { z } from "zod";

export default defineAction({
  description:
    "Analyze a website URL in a real browser and return a bounded design.md-style " +
    "visual system: computed colors, typography, spacing, radii, shadows, " +
    "component styles, CSS variables, logo references, and reusable Brand Kit data. " +
    "Uses a static SSRF-safe fallback only when a browser is unavailable.",
  schema: z.object({
    url: z.string().describe("Website URL to analyze"),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ url }) => {
    return extractRenderedDesignSystemFromUrl(url);
  },
});
