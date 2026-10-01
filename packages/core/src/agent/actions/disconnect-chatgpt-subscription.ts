import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import {
  disconnectChatGPTSubscription,
  removeLegacyChatGPTSubscriptionCredential,
} from "../../server/chatgpt-subscription-oauth.js";

export default defineAction({
  description:
    "Sign out of one of the current user's saved ChatGPT registrations, or remove an unusable credential from the older experimental ChatGPT flow. Remote revocation is attempted for current registrations; it cannot be confirmed for the older credential.",
  schema: z.object({
    accountId: z
      .string()
      .optional()
      .describe(
        "Saved ChatGPT registration ID. Omit to disconnect the active registration.",
      ),
    removeLegacyCredential: z
      .boolean()
      .optional()
      .describe(
        "Remove the user's unusable credential from the older experimental ChatGPT flow.",
      ),
  }),
  run: async (_args, ctx) => {
    const email = ctx?.userEmail;
    if (!email) fail("Not authenticated.", { statusCode: 401 });
    try {
      if (_args.removeLegacyCredential) {
        return await removeLegacyChatGPTSubscriptionCredential(email);
      }
      return await disconnectChatGPTSubscription(email, _args.accountId);
    } catch (error) {
      fail(
        error instanceof Error
          ? error.message
          : "Unable to disconnect ChatGPT.",
        { statusCode: 400 },
      );
    }
  },
});
