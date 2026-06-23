/**
 * connect-slack
 *
 * Returns the Slack OAuth URL for connecting Agent-Native Clips for Slack.
 * The browser opens the URL in a popup/new tab; the callback stores the bot
 * token in app_secrets and writes only metadata + secret refs to SQL.
 */

import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";
import { SLACK_UNFURL_SCOPES } from "../server/lib/slack-oauth.js";

export default defineAction({
  description:
    "Get the OAuth URL to connect Agent-Native Clips for Slack. Open the returned URL in a popup or new tab.",
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
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      throw new Error("Not authenticated — sign in before connecting Slack.");
    }

    const params = new URLSearchParams({ redirect: "1" });
    if (args.returnUrl) params.set("return", args.returnUrl);
    return {
      url: `/api/slack/oauth/install?${params.toString()}`,
      scopes: SLACK_UNFURL_SCOPES,
    };
  },
});
