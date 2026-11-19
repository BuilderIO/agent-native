import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import {
  contentPageListSchema,
  listContentPages,
} from "../server/lib/content-page-files.js";

export default defineAction({
  description:
    "List Content pages and collections the user can attach to an email as a file: the most recently updated, or search results, limited to what the user can open in Content. Each item says the format it attaches as (markdown for a page, csv for a collection). Pass an item's id to attach-content-page. Changes nothing.",
  schema: z.object({
    search: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe("Optional search within page titles and text."),
    page: z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .default(1)
      .describe("One-based result page; 30 items a page. Defaults to 1."),
  }),
  outputSchema: contentPageListSchema,
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    if (!getRequestUserEmail()) {
      fail("Sign in to attach a Content page.", {
        statusCode: 401,
        errorCode: "unauthorized",
      });
    }
    return listContentPages(args);
  },
});
