import { defineEventHandler, setResponseStatus, type H3Event } from "h3";

import { getCredentialContextFromEvent } from "../../../../lib/credentials.js";
import {
  getGitHubOAuthStatus,
  isGitHubOAuthConfigured,
} from "../../../../lib/github-oauth.js";

export default defineEventHandler(async (event: H3Event) => {
  const ctx = await getCredentialContextFromEvent(event);
  if (!ctx) {
    setResponseStatus(event, 401);
    return {
      configured: isGitHubOAuthConfigured(),
      connected: false,
      error: "Sign in to view GitHub connection status.",
    };
  }
  return getGitHubOAuthStatus(ctx);
});
