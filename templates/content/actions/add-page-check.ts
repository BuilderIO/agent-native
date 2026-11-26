import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { documentChangeResource } from "../server/lib/document-change-resource.js";
import { addPageCheck } from "../server/lib/page-checks.js";
import {
  PAGE_CHECK_ANSWERS_HELP,
  pageCheckAddedOutput,
  pageCheckScopeSchema,
  pageCheckSentenceSchema,
} from "./_page-check-schemas.js";

export default defineAction({
  description: `Add a check to a page: one sentence, like "At most 120 words", that marks the parts of the page that don't pass. A check never changes the page and posts nothing. It runs once when added, and the result lists every check on the page. Use try-page-check first to see what a sentence reads as. A page holds at most 20 checks. ${PAGE_CHECK_ANSWERS_HELP} Requires edit access.`,
  schema: z.object({
    documentId: z.string().min(1).describe("Page document ID"),
    sentence: pageCheckSentenceSchema,
    scope: pageCheckScopeSchema,
  }),
  outputSchema: pageCheckAddedOutput,
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  searchHints: ["word count limit", "length check", "lint my draft"],
  changeResource: (input) => documentChangeResource(input.documentId),
  run: async (args) => addPageCheck(args),
});
