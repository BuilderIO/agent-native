import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { tryPageCheck } from "../server/lib/page-checks.js";
import {
  pageCheckScopeSchema,
  pageCheckSentenceSchema,
  pageCheckTryOutput,
} from "./_page-check-schemas.js";

export default defineAction({
  description:
    "Try a check's sentence on a page without saving it: what each part of the sentence reads as (a count, or unread when Content can't read it yet), and what it would find at each place. Saves an open editor's changes first. Requires edit access.",
  schema: z.object({
    documentId: z.string().min(1).describe("Page document ID"),
    sentence: pageCheckSentenceSchema,
    scope: pageCheckScopeSchema,
  }),
  outputSchema: pageCheckTryOutput,
  readOnly: true,
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (args) => tryPageCheck(args),
});
