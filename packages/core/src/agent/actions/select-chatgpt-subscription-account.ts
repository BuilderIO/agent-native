import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { selectChatGPTSubscriptionAccount } from "../../server/chatgpt-subscription-oauth.js";

export default defineAction({
  requiresSignedInBrowser: true,
  description:
    "Set one of the current user's saved ChatGPT registrations as active.",
  schema: z.object({
    accountId: z.string().min(1).max(80),
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  mcpTool: false,
  run: async (args, ctx) => {
    const email = ctx?.userEmail;
    if (!email) fail("Not authenticated.", { statusCode: 401 });
    try {
      return await selectChatGPTSubscriptionAccount(email, args.accountId);
    } catch (error) {
      fail(
        error instanceof Error
          ? error.message
          : "Unable to select ChatGPT account.",
        { statusCode: 400 },
      );
    }
  },
});
