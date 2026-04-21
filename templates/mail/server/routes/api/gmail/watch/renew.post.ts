import {
  defineEventHandler,
  getHeader,
  setResponseStatus,
  type H3Event,
} from "h3";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { listOAuthAccounts } from "@agent-native/core/oauth-tokens";
import {
  getClientFromAccount,
  startWatch,
} from "../../../../lib/google-auth.js";

// Gmail watches expire after 7 days, so something has to call watch() on a
// schedule. The in-process setInterval in mail-jobs.ts is unreliable on
// serverless hosts where function instances don't stay warm long enough to
// see the 12h tick. Instead, Cloud Scheduler POSTs to this endpoint every
// ~6 hours with an OIDC token signed by the same service account we use
// for Pub/Sub pushes (gmail-push-signer), so we can reuse the same signer
// check. The audience is per-URL — set GMAIL_WATCH_RENEW_AUDIENCE to this
// endpoint's full URL.

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

async function verifyCallerToken(
  authHeader: string,
  audience: string,
  expectedSigner: string,
): Promise<JWTPayload> {
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("missing bearer token");
  }
  const token = authHeader.slice(7);
  const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
    issuer: GOOGLE_ISSUERS,
    audience,
  });
  if (payload.email_verified !== true) {
    throw new Error("email_verified claim is not true");
  }
  if (payload.email !== expectedSigner) {
    // Log the caller's claimed email — service-account identities aren't
    // sensitive, and this is invaluable when debugging misconfig vs attack.
    throw new Error(`unexpected signer: ${payload.email}`);
  }
  return payload;
}

export default defineEventHandler(async (event: H3Event) => {
  // Treat missing config as 503 "service unavailable", not 401. These are
  // operator errors, not caller errors — surfacing them as auth failures
  // pollutes the push/renew auth-error metric and misleads on-call.
  const audience = process.env.GMAIL_WATCH_RENEW_AUDIENCE;
  const expectedSigner = process.env.GMAIL_PUSH_SIGNER_EMAIL;
  if (!audience || !expectedSigner) {
    setResponseStatus(event, 503);
    return { ok: false, error: "renew endpoint disabled" };
  }

  const authHeader = getHeader(event, "authorization") || "";
  try {
    await verifyCallerToken(authHeader, audience, expectedSigner);
  } catch (err: any) {
    console.warn(`[gmail-watch-renew] OIDC verify failed: ${err.message}`);
    setResponseStatus(event, 401);
    return { ok: false, error: "unauthorized" };
  }

  if (!process.env.GMAIL_WATCH_TOPIC) {
    return { ok: true, skipped: "GMAIL_WATCH_TOPIC not set" };
  }

  // Load the full account list once and reuse it in the loop; calling
  // getClientForAccount(accountId) would re-scan oauth_tokens per account.
  const accounts = await listOAuthAccounts("google");
  let succeeded = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const acc of accounts) {
    try {
      const client = await getClientFromAccount(acc);
      if (!client) {
        failed += 1;
        errors.push(`${acc.accountId}: no valid token`);
        continue;
      }
      const res = await startWatch(client.accessToken);
      if (res) {
        succeeded += 1;
      } else {
        failed += 1;
        errors.push(`${acc.accountId}: startWatch returned null`);
      }
    } catch (err: any) {
      failed += 1;
      errors.push(`${acc.accountId}: ${err.message}`);
    }
  }

  console.log(
    `[gmail-watch-renew] ${succeeded}/${accounts.length} ok, ${failed} failed`,
  );

  return {
    ok: true,
    total: accounts.length,
    succeeded,
    failed,
    // Cap error list — scheduler treats any 2xx as success, body is just for
    // human inspection in the scheduler UI or logs.
    errors: errors.slice(0, 20),
  };
});
