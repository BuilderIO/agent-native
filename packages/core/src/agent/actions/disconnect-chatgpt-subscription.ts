import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { disconnectChatGPTSubscription } from "../../server/chatgpt-subscription-oauth.js";

export default defineAction({
  description:
    "Disconnect the current user's ChatGPT subscription from the experimental Codex engine.",
  schema: z.object({}),
  run: async (_args, ctx) => {
    const email = ctx?.userEmail;
    if (!email) fail("Not authenticated.", { statusCode: 401 });
    await disconnectChatGPTSubscription(email);
    return { connected: false };
  },
});
