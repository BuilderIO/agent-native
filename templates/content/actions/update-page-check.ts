import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { documentChangeResource } from "../server/lib/document-change-resource.js";
import { updatePageCheck } from "../server/lib/page-checks.js";
import {
  PAGE_CHECK_ANSWERS_HELP,
  pageChecksOutput,
  pageCheckScopeSchema,
  pageCheckSentenceSchema,
} from "./_page-check-schemas.js";

export default defineAction({
  description: `Change one of a page's checks: its sentence, where it looks, or whether it's paused. A paused check keeps its last answers and isn't run. The result lists every check on the page. ${PAGE_CHECK_ANSWERS_HELP} Requires edit access.`,
  schema: z.object({
    documentId: z.string().min(1).describe("Page document ID"),
    checkId: z.string().min(1).describe("Check ID from list-page-checks"),
    sentence: pageCheckSentenceSchema.optional(),
    scope: pageCheckScopeSchema.optional(),
    paused: z.boolean().optional().describe("true pauses the check"),
  }),
  outputSchema: pageChecksOutput,
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  retrySafe: true,
  changeResource: (input) => documentChangeResource(input.documentId),
  run: async (args) => updatePageCheck(args),
});
