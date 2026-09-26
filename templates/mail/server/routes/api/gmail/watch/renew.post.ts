import { listOAuthAccounts } from "@agent-native/core/oauth-tokens";
import {
  defineEventHandler,
  getHeader,
  setResponseStatus,
  type H3Event,
} from "h3";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import {
  getClientFromAccount,
  startWatch,
} from "../../../../lib/google-auth.js";


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
    throw new Error(`unexpected signer: ${String(payload.email)}`);
  }
  return payload;
}

export default defineEventHandler(async (event: H3Event) => {
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

  const accounts = await listOAuthAccounts("google");
  let succeeded = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const acc of accounts) {
    try {
      const client = await getClientFromAccount({
        ...acc,
        owner: acc.owner ?? undefined,
      });
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
    errors: errors.slice(0, 20),
  };
});
