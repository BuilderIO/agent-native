import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { getChatGPTSubscriptionStatus } from "../../server/chatgpt-subscription-oauth.js";

export default defineAction({
  description:
    "Return the current user's ChatGPT subscription support, selected registration, and saved account registrations.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx) => {
    const email = ctx?.userEmail;
    if (!email) fail("Not authenticated.", { statusCode: 401 });
    return getChatGPTSubscriptionStatus(email);
  },
});
