import { z } from "zod";

import { defineAction, defineActionErrors } from "../../action.js";
import {
  getRequestContext,
  getRequestRunContext,
} from "../../server/request-context.js";
import { mintMcpTurnGrant } from "../turn-grant-store.js";

const errors = defineActionErrors("turn_grant_ui_required");

export default defineAction({
  description:
    "Mint a short-lived MCP user-turn grant from the signed-in app page. Only actions that declare `userTurn` accept it.",
  schema: z.object({}).strict(),
  outputSchema: z.object({ grantId: z.string() }),
  http: { method: "POST" },
  uiOnly: true,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  persistInChatHistory: false,
  audit: { enabled: false },
  errors,
  run: async (_args, ctx) => {
    if (
      ctx?.caller !== "frontend" ||
      ctx.automation ||
      !ctx.userEmail ||
      !ctx.appId ||
      getRequestContext()?.provenUiRequest !== true ||
      getRequestRunContext()?.runId ||
      getRequestRunContext()?.isBackgroundWorker
    ) {
      return errors.fail(
        "A proven signed-in app page is required to mint a turn grant.",
        "turn_grant_ui_required",
        { statusCode: 403 },
      );
    }
    return mintMcpTurnGrant(ctx.userEmail, ctx.appId);
  },
});
