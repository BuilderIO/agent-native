import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { tryPageCheck } from "../server/lib/page-checks.js";
import {
  pageCheckQuestionsSchema,
  pageCheckScopeSchema,
  pageCheckSentenceSchema,
  pageCheckSureSchema,
  pageCheckTryOutput,
} from "./_page-check-schemas.js";

export default defineAction({
  description:
    "Try a check's sentence on a page without saving it: what each part reads as (a count, or a yes/no question with the question written for it), who answers the questions, and what it would find at each place. A problem says why it can't be asked yet: too vague (with two sharper examples), no decision model, or no question written. Yes/no parts count toward the page's daily limit. Saves an open editor's changes first. Requires edit access.",
  schema: z.object({
    documentId: z.string().min(1).describe("Page document ID"),
    sentence: pageCheckSentenceSchema,
    scope: pageCheckScopeSchema,
    questions: pageCheckQuestionsSchema,
    sure: pageCheckSureSchema,
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
