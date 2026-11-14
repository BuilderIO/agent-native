import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { disconnectSlackHuddleConnection } from "../server/lib/slack-huddle-oauth.js";

export default defineAction({
  description:
    "Disconnect your Slack account for huddles. Revokes and deletes the stored Slack user token; participants already added to meetings stay.",
  schema: z.object({
    id: z.string().describe("slack_user_connections.id"),
  }),
  run: async (args) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) throw new Error("Not authenticated.");
    const done = await disconnectSlackHuddleConnection({
      id: args.id,
      userEmail,
    });
    if (!done) throw new Error(`Slack connection not found: ${args.id}`);
    return { id: args.id, disconnected: true };
  },
});
