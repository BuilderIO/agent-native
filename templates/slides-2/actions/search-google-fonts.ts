import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import {
  GoogleFontError,
  MAX_GOOGLE_FONT_RESULTS,
  searchGoogleFonts,
} from "../server/lib/google-fonts.js";

export default defineAction({
  title: "Search Google Fonts",
  description:
    "Search the public Google Fonts catalog and return bounded family metadata and available variants. Font files are imported separately before they can be applied to a deck.",
  schema: z.object({
    q: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe("Font family search text, up to 120 characters."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_GOOGLE_FONT_RESULTS)
      .default(MAX_GOOGLE_FONT_RESULTS)
      .describe("Maximum results to return, up to 24."),
  }),
  http: { method: "GET" },
  readOnly: true,
  requiresAuth: true,
  retrySafe: true,
  mcpAnnotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  },
  run: async ({ q, limit }) => {
    if (!getRequestUserEmail()) {
      fail("Sign in to search fonts.", {
        errorCode: "google_font_auth_required",
        statusCode: 401,
      });
    }
    try {
      return (await searchGoogleFonts(q)).slice(0, limit);
    } catch (error) {
      if (error instanceof GoogleFontError) {
        fail(error.message, {
          errorCode: error.errorCode,
          statusCode: error.statusCode,
        });
      }
      fail("Google Fonts search could not be completed.", {
        errorCode: "google_font_search_failed",
        statusCode: 502,
      });
    }
  },
});
