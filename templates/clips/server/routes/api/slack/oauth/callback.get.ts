import {
  decodeOAuthState,
  getAppUrl,
  logOAuthStateDecodeFailure,
  oauthErrorPage,
} from "@agent-native/core/server";
import { defineEventHandler, getQuery, type H3Event } from "h3";

import {
  handleSlackHuddlesOAuthCallback,
  isSlackHuddlesConnectState,
} from "../../../../lib/slack-huddle-oauth.js";
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

  // "Connect Slack for huddles" shares this
  // redirect URL; its state names its own app.
  if (isSlackHuddlesConnectState(state)) {
    return handleSlackHuddlesOAuthCallback(event, state);
  }

  return handleSlackOAuthCallback(event, state);
});
