import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { documentChangeResource } from "../server/lib/document-change-resource.js";
import { deletePageCheck } from "../server/lib/page-checks.js";

export default defineAction({
  description:
    "Delete one of a page's checks, with its answers and skips. The page itself is unchanged. Requires edit access.",
  schema: z.object({
    documentId: z.string().min(1).describe("Page document ID"),
    checkId: z.string().min(1).describe("Check ID from list-page-checks"),
  }),
  outputSchema: z.object({
    documentId: z.string(),
    checkId: z.string(),
    deleted: z.literal(true),
  }),
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  changeResource: (input) => documentChangeResource(input.documentId),
  run: async (args) => deletePageCheck(args),
});
