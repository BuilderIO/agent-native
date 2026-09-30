import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { disconnectChatGPTSubscription } from "../../server/chatgpt-subscription-oauth.js";

export default defineAction({
  description:
    "Sign out of one of the current user's saved ChatGPT registrations. Remote refresh-token revocation is attempted, local tokens are cleared, and the registration remains available for later sign-in.",
  schema: z.object({
    accountId: z
      .string()
      .optional()
      .describe(
        "Saved ChatGPT registration ID. Omit to disconnect the active registration.",
      ),
  }),
  run: async (_args, ctx) => {
    const email = ctx?.userEmail;
    if (!email) fail("Not authenticated.", { statusCode: 401 });
    try {
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
