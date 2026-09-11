import {
  decodeOAuthState,
  getAppUrl,
  logOAuthStateDecodeFailure,
  oauthErrorPage,
} from "@agent-native/core/server";
import { defineEventHandler, getQuery, type H3Event } from "h3";

import { handleSlackOAuthCallback } from "../../../../lib/slack-oauth.js";

export default defineEventHandler(async (event: H3Event) => {
  const state = decodeOAuthState(
    getQuery(event).state as string | undefined,
    getAppUrl(event, "/api/slack/oauth/callback"),
  );
  if (!state.ok) {
    logOAuthStateDecodeFailure(event, state.reason, "slack");
    return oauthErrorPage(
      "Start Slack installation from Clips Settings so this workspace can be connected to your account.",
    );
  }

  return handleSlackOAuthCallback(event, state);
});
