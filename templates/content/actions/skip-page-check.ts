import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { documentChangeResource } from "../server/lib/document-change-resource.js";
import { skipPageCheckPlace } from "../server/lib/page-checks.js";

export default defineAction({
  description:
    "Tell a check to leave one place alone until its text changes, or with undo, stop leaving it alone. Other places keep their answers. Requires edit access.",
  schema: z.object({
    documentId: z.string().min(1).describe("Page document ID"),
    checkId: z.string().min(1).describe("Check ID from list-page-checks"),
    placeKey: z
      .string()
      .min(1)
      .describe("The answer's key from list-page-checks"),
    textHash: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The place's textHash as shown; omit to use the page as last saved",
      ),
    undo: z.boolean().optional().describe("true stops skipping the place"),
  }),
  outputSchema: z.object({
    documentId: z.string(),
    checkId: z.string(),
    skipped: z.boolean(),
  }),
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  retrySafe: true,
  changeResource: (input) => documentChangeResource(input.documentId),
  run: async (args) => skipPageCheckPlace(args),
});
