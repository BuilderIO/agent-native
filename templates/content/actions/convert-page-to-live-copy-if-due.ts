import { ActionContractError } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { convertPageToLiveCopyIfDue } from "../server/live-copy/backfill.js";
import { assertDocumentMutationAccess } from "./_document-mutation-access.js";

export default defineAction({
  description:
    "Switch one page to its live copy when the backfill rollout has reached its owner and every writer that reaches it can write through the copy. The editor calls it once a page it can edit has loaded.",
  uiOnly: true,
  agentTool: false,
  toolCallable: false,
  mcpTool: false,
  schema: z.object({
    id: z.string().min(1).describe("Document ID"),
  }),
  run: async (args, ctx) => {
    await assertDocumentMutationAccess(args.id, "editor", "id");
    try {
      return {
        id: args.id,
        ...(await convertPageToLiveCopyIfDue(args.id, { ctx })),
      };
    } catch (error) {
      console.error(
        `[convert-page-to-live-copy-if-due] page ${args.id} failed:`,
        error,
      );
      throw new ActionContractError(
        `Page ${args.id} couldn't switch to its live copy: ${error instanceof Error ? error.message : String(error)}`,
        {
          errorCode: "LIVE_BODY_BACKFILL_FAILED",
          statusCode: 500,
          details: { documentId: args.id },
        },
      );
    }
  },
});
