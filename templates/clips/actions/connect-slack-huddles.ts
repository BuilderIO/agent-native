import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { SLACK_HUDDLE_USER_SCOPES } from "../server/lib/slack-huddles.js";

export default defineAction({
  description:
    "Get the OAuth URL to connect your own Slack account for huddles, so recorded Slack huddles list who was in them. Open the returned URL in a popup or new tab.",
  schema: z.object({
    returnUrl: z
      .string()
      .optional()
      .describe("Same-origin path to return to after Slack connects."),
  }),
  http: { method: "GET" },
  run: async (args) => {
    if (!process.env.SLACK_CLIENT_ID || !process.env.SLACK_CLIENT_SECRET) {
      throw new Error(
        "Slack OAuth is not configured. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET first.",
      );
    }
    if (!getRequestUserEmail()) {
      throw new Error("Not authenticated — sign in before connecting Slack.");
    }
    const params = new URLSearchParams({ redirect: "1" });
    if (args.returnUrl) params.set("return", args.returnUrl);
    return {
      url: `/api/slack/huddles/install?${params.toString()}`,
      scopes: SLACK_HUDDLE_USER_SCOPES,
    };
  },
});
