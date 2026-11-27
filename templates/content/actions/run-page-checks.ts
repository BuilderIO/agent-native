import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { documentChangeResource } from "../server/lib/document-change-resource.js";
import { runPageChecks } from "../server/lib/page-checks.js";
import {
  PAGE_CHECK_ANSWERS_HELP,
  pageChecksOutput,
} from "./_page-check-schemas.js";

export default defineAction({
  description: `Run a page's checks: saves an open editor's changes, checks each place whose text or check changed since it was last checked, and lists every check's answers. Never changes the page. Use it after drafting to see what still doesn't pass. ${PAGE_CHECK_ANSWERS_HELP} Requires edit access.`,
  schema: z.object({
    documentId: z.string().min(1).describe("Page document ID"),
    checkIds: z
      .array(z.string().min(1))
      .max(20)
      .optional()
      .describe("Only these checks; omit for all"),
    editorSaved: z
      .boolean()
      .optional()
      .describe(
        "Set only by the page's open editor right after it saved, so it isn't asked to save again",
      ),
  }),
  outputSchema: pageChecksOutput,
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  retrySafe: true,
  emptyListsEraseNothing: true,
  automatic: (input) => input.editorSaved === true,
  changeResource: (input) => documentChangeResource(input.documentId),
  run: async (args) =>
    runPageChecks({
      ...args,
      checkIds: args.checkIds?.length ? args.checkIds : undefined,
    }),
});
