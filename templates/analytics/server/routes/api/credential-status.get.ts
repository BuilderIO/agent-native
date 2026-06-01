import { defineEventHandler, createError } from "h3";
import {
  getCredentialContextFromEvent,
  hasCredential,
} from "../../lib/credentials";
import { credentialKeys } from "../../lib/credential-keys";
import { getGitHubAccessToken } from "../../lib/github-oauth";

export default defineEventHandler(async (event) => {
  const ctx = await getCredentialContextFromEvent(event);
  if (!ctx) {
    throw createError({
      statusCode: 401,
      statusMessage: "Sign in to view credential status.",
    });
  }
  const results = await Promise.all(
    credentialKeys.map(async (cfg) => {
      const configured =
        cfg.key === "GITHUB_TOKEN"
          ? !!(await getGitHubAccessToken(ctx)).token
          : await hasCredential(cfg.key, ctx);
      return {
        key: cfg.key,
        label: cfg.label,
        required: cfg.required,
        configured,
      };
    }),
  );
  return results;
});
