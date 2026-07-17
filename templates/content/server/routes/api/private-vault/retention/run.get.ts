import { createHash, timingSafeEqual } from "node:crypto";

import {
  createError,
  defineEventHandler,
  getHeader,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { privateVaultRetentionService } from "../../../../lib/private-vault-retention.js";

type CronAuthenticator =
  | { kind: "sha256"; digest: Buffer }
  | { kind: "secret"; value: string };

function configuredAuthenticator(): CronAuthenticator | null {
  const digest =
    process.env.CONTENT_PRIVATE_VAULT_RETENTION_CRON_SECRET_SHA256?.trim(); // guard:allow-env-credential — one-way verifier for a deployment-level cron authenticator, never a user credential.
  if (digest) {
    if (!/^[a-f0-9]{64}$/i.test(digest)) return null;
    return { kind: "sha256", digest: Buffer.from(digest, "hex") };
  }

  const secret =
    process.env.CRON_SECRET?.trim() || // guard:allow-env-credential — Vercel's deployment-level cron authenticator, never a user credential.
    process.env.CONTENT_PRIVATE_VAULT_RETENTION_CRON_SECRET?.trim(); // guard:allow-env-credential — self-hosted deployment-level cron authenticator, never a user credential.
  return secret ? { kind: "secret", value: secret } : null;
}

function authorized(
  value: string | undefined,
  authenticator: CronAuthenticator,
): boolean {
  if (authenticator.kind === "sha256") {
    const match = /^Bearer ([^\s]+)$/.exec(value?.trim() ?? "");
    if (!match) return false;
    const suppliedDigest = createHash("sha256").update(match[1]).digest();
    return timingSafeEqual(suppliedDigest, authenticator.digest);
  }

  const expected = `Bearer ${authenticator.value}`;
  const supplied = value?.trim() ?? "";
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

/** Platform-cron entry point. It is operator-authenticated and never a tool. */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  const authenticator = configuredAuthenticator();
  if (!authenticator) {
    throw createError({
      statusCode: 503,
      statusMessage:
        "A valid Private Vault retention cron authenticator is required",
    });
  }
  const authorization = getHeader(event, "authorization");
  const isAuthorized = authorized(authorization, authenticator);
  const diagnosticsEnabled =
    process.env.CONTENT_PRIVATE_VAULT_RETENTION_CRON_DIAGNOSTICS === "1"; // guard:allow-env-credential — temporary content-free diagnostics for the isolated synthetic deployment.
  if (diagnosticsEnabled) {
    const supplied = authorization?.trim() ?? "";
    setResponseHeader(
      event,
      "X-Private-Vault-Cron-Auth-Mode",
      authenticator.kind,
    );
    setResponseHeader(
      event,
      "X-Private-Vault-Cron-Authorization-Length",
      String(supplied.length),
    );
    setResponseHeader(
      event,
      "X-Private-Vault-Cron-Bearer-Syntax",
      String(/^Bearer ([^\s]+)$/.test(supplied)),
    );
    setResponseHeader(
      event,
      "X-Private-Vault-Cron-Authorized",
      String(isAuthorized),
    );
  }
  if (!isAuthorized) {
    if (diagnosticsEnabled) {
      setResponseStatus(event, 401, "Unauthorized");
      return { error: "Unauthorized" };
    }
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  return { ok: true, ...(await privateVaultRetentionService.sweep()) };
});
