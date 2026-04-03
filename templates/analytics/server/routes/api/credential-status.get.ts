import { defineEventHandler } from "h3";
import { hasCredential } from "../../lib/credentials";
import { credentialKeys } from "../../lib/credential-keys";

export default defineEventHandler(async () => {
  const results = await Promise.all(
    credentialKeys.map(async (cfg) => ({
      key: cfg.key,
      label: cfg.label,
      required: cfg.required,
      configured: await hasCredential(cfg.key),
    })),
  );
  return results;
});
