import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listPageChecks } from "../server/lib/page-checks.js";
import {
  PAGE_CHECK_ANSWERS_HELP,
  pageChecksOutput,
} from "./_page-check-schemas.js";

export default defineAction({
  description: `List a page's checks: sentences like "At most 120 words" that mark the parts of the page that don't pass, without changing it. Reads the page as last saved and checks nothing. ${PAGE_CHECK_ANSWERS_HELP} Requires comment access to the page.`,
  schema: z.object({
    documentId: z.string().min(1).describe("Page document ID"),
  }),
  outputSchema: pageChecksOutput,
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  searchHints: ["word count limit", "length check", "lint my draft"],
  run: async ({ documentId }) => listPageChecks(documentId),
});
