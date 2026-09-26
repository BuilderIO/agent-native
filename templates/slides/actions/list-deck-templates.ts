import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  DECK_TEMPLATE_CATEGORIES,
  listBuiltInDeckTemplateSummaries,
} from "../server/lib/deck-templates.js";

export default defineAction({
  description:
    "Browse built-in editable deck templates without a provider or generation. Search titles, descriptions, and categories; previews include only the first slide. Use get-deck-template to inspect all slides, then create-deck-from-template to copy one.",
  schema: z.object({
    search: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe("Case-insensitive title, description, or category search"),
    category: z
      .enum(DECK_TEMPLATE_CATEGORIES)
      .optional()
      .describe(
        "Limit to one starter category; omitted returns all categories",
      ),
    page: z.coerce
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(1)
      .describe("One-based page; defaults to 1"),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(24)
      .default(6)
      .describe("Results per page, 1–24; defaults to 6"),
    includePreview: z
      .enum(["true", "false"])
      .default("false")
      .describe("Include first-slide HTML when true; defaults to false"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({
    search,
    category,
    page = 1,
    pageSize = 6,
    includePreview = "false",
  }) => {
    const query = search?.trim().toLowerCase();
    const matches = listBuiltInDeckTemplateSummaries(
      includePreview === "true",
    ).filter(
      (item) =>
        (!category || item.category === category) &&
        (!query ||
          `${item.title} ${item.description} ${item.category}`
            .toLowerCase()
            .includes(query)),
    );
    const offset = (page - 1) * pageSize;
    return {
      templates: matches.slice(offset, offset + pageSize),
      total: matches.length,
      page,
      pageSize,
      hasMore: offset + pageSize < matches.length,
    };
  },
});
