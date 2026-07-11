import {
  deleteOAuthTokens,
  listOAuthAccountsByOwner,
} from "@agent-native/core/oauth-tokens";
import { defineEventHandler, setResponseStatus, type H3Event } from "h3";

import {
  deleteCredential,
  getCredentialContextFromEvent,
} from "../../../../lib/credentials.js";

export default defineEventHandler(async (event: H3Event) => {
  const ctx = await getCredentialContextFromEvent(event);
  if (!ctx) {
    setResponseStatus(event, 401);
    return { error: "Sign in to disconnect GitHub." };
  }

  const accounts = await listOAuthAccountsByOwner("github", ctx.userEmail);
  for (const account of accounts) {
    await deleteOAuthTokens("github", account.accountId);
  }
  await deleteCredential("GITHUB_TOKEN", ctx);
  return { success: true, disconnected: accounts.length };
});
