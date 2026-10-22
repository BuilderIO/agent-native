import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { searchSvglLogos, SvglError } from "../server/lib/svgl.js";

export default defineAction({
  title: "Search SVGL logos",
  description:
    "Search the public SVGL logo catalog by title and return bounded, validated HTTPS SVG routes for preview or import.",
  schema: z.object({
    q: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe("Logo title or brand name to search, up to 120 characters."),
  }),
  http: { method: "GET" },
  readOnly: true,
  retrySafe: true,
  mcpAnnotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  },
  run: async ({ q }) => {
    try {
      return await searchSvglLogos(q);
    } catch (error) {
      if (error instanceof SvglError) {
        fail(error.message, {
          errorCode: error.errorCode,
          statusCode: error.statusCode,
        });
      }
      fail("SVGL logo search could not be completed.", {
        errorCode: "svgl_search_failed",
        statusCode: 502,
      });
    }
  },
});
