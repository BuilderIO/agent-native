import { timingSafeEqual } from "node:crypto";

import {
  createError,
  defineEventHandler,
  getHeader,
  setResponseHeader,
} from "h3";

import { privateVaultRetentionService } from "../../../../lib/private-vault-retention.js";

function configuredSecret(): string | null {
  const secret =
    process.env.CRON_SECRET?.trim() || // guard:allow-env-credential — Vercel's deployment-level cron authenticator, never a user credential.
    process.env.CONTENT_PRIVATE_VAULT_RETENTION_CRON_SECRET?.trim(); // guard:allow-env-credential — self-hosted deployment-level cron authenticator, never a user credential.
  return secret ? secret : null;
}

function authorized(value: string | undefined, secret: string): boolean {
  const expected = `Bearer ${secret}`;
  const supplied = value?.trim() ?? "";
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

/** Platform-cron entry point. It is operator-authenticated and never a tool. */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  const secret = configuredSecret();
  if (!secret) {
    throw createError({
      statusCode: 503,
      statusMessage: "A Private Vault retention cron secret is required",
    });
  }
  if (!authorized(getHeader(event, "authorization"), secret)) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  return { ok: true, ...(await privateVaultRetentionService.sweep()) };
});
