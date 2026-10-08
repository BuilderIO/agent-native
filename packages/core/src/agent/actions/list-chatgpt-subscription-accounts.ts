import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { listChatGPTSubscriptionAccounts } from "../../server/chatgpt-subscription-oauth.js";

export default defineAction({
  description:
    "List the current user's saved ChatGPT registrations without exposing credentials.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx) => {
    const email = ctx?.userEmail;
    if (!email) fail("Not authenticated.", { statusCode: 401 });
    return listChatGPTSubscriptionAccounts(email);
  },
});
