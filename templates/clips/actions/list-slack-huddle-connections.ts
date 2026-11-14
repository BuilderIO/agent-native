import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { listSlackHuddleConnections } from "../server/lib/slack-huddle-oauth.js";

export default defineAction({
  description:
    "List your own Slack accounts connected for huddle participants. Tokens are never returned.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) throw new Error("Not authenticated.");
    return {
      oauthConfigured: Boolean(
        process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET,
      ),
      connections: await listSlackHuddleConnections(userEmail),
    };
  },
});
