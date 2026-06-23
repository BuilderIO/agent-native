import { defineEventHandler, getQuery, type H3Event } from "h3";
import { decodeOAuthState, getAppUrl } from "@agent-native/core/server";
import { handleSlackOAuthCallback } from "../../../../lib/slack-oauth.js";

export default defineEventHandler(async (event: H3Event) => {
  const state = decodeOAuthState(
    getQuery(event).state as string | undefined,
    getAppUrl(event, "/api/slack/oauth/callback"),
  );

  return handleSlackOAuthCallback(event, state);
});
