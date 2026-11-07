import { defineAction, defineActionErrors } from "@agent-native/core/action";
import {
  GoogleFontError,
  filterGoogleFontCatalog,
  readGoogleFontCatalog,
} from "@agent-native/core/server";
import { z } from "zod";

const errors = defineActionErrors("google_fonts_unavailable");

const googleFontSchema = z.object({
  family: z.string(),
  category: z.string(),
  weights: z.array(z.number().int()),
  italicWeights: z.array(z.number().int()),
  variable: z.boolean(),
});

export default defineAction({
  description:
    "List Google Fonts families, most popular first, with each family's upright and italic weights and whether it is variable. Pass q to check a name; omit q for the whole library (about 1,900 families). Any family listed renders on slides.",
  schema: z.object({
    q: z
      .string()
      .trim()
      .max(120)
      .optional()
      .describe("Case-insensitive family name filter; omit for every family"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(5000)
      .optional()
      .describe("Maximum families to return; omit for every match"),
  }),
  outputSchema: z.object({
    fonts: z.array(googleFontSchema),
    total: z.number().int(),
  }),
  errors,
  http: { method: "GET" },
  readOnly: true,
  // Public catalog data: anonymous viewers of shared decks load fonts too.
  requiresAuth: false,
  mcpAnnotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  },
  run: async ({ q, limit }) => {
    let catalog;
    try {
      catalog = await readGoogleFontCatalog();
    } catch (error) {
      if (!(error instanceof GoogleFontError)) throw error;
      return errors.fail(error.message, "google_fonts_unavailable", {
        statusCode: error.statusCode >= 500 ? 503 : error.statusCode,
      });
    }
    const matches = q ? filterGoogleFontCatalog(catalog, q) : catalog;
    return {
      fonts: limit === undefined ? matches : matches.slice(0, limit),
      total: matches.length,
    };
  },
});
