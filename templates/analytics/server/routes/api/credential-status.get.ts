import { defineEventHandler, createError } from "h3";
import { hasCredential } from "../../lib/credentials";
import { credentialKeys } from "../../lib/credential-keys";
import { getCredentialContextFromEvent } from "../../lib/credentials";

export default defineEventHandler(async (event) => {
  const ctx = await getCredentialContextFromEvent(event);
  if (!ctx) {
    throw createError({
      statusCode: 401,
      statusMessage: "Sign in to view credential status.",
    });
  }
  const results = await Promise.all(
    credentialKeys.map(async (cfg) => ({
      key: cfg.key,
      label: cfg.label,
      required: cfg.required,
      configured: await hasCredential(cfg.key, ctx),
    })),
  );
  return results;
});
