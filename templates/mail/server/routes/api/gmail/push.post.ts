import {
  defineEventHandler,
  readBody,
  getHeader,
  setResponseStatus,
  type H3Event,
} from "h3";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { listOAuthAccounts } from "@agent-native/core/oauth-tokens";
import {
  bumpHistoryWatermark,
  invalidateListCacheForOwner,
} from "../../../lib/google-auth.js";

// Cache Google's public keys for OIDC verification. jose handles TTL + refresh.
// https://cloud.google.com/pubsub/docs/push#validate_tokens
const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

async function verifyPubSubToken(authHeader: string): Promise<JWTPayload> {
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("missing bearer token");
  }
  const token = authHeader.slice(7);
  const audience = process.env.GMAIL_PUSH_AUDIENCE;
  if (!audience) {
    throw new Error("GMAIL_PUSH_AUDIENCE not configured");
  }

  const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
    issuer: GOOGLE_ISSUERS,
    audience,
  });

  if (payload.email_verified !== true) {
    throw new Error("email_verified claim is not true");
  }

  // Optional pin to the specific service account Pub/Sub signs as. Blocks
  // any other Google-issued token that happens to have the right audience.
  const expectedSigner = process.env.GMAIL_PUSH_SIGNER_EMAIL;
  if (expectedSigner && payload.email !== expectedSigner) {
    throw new Error(`unexpected signer: ${payload.email}`);
  }

  return payload;
}

export default defineEventHandler(async (event: H3Event) => {
  // OIDC verification is opt-in via env. When GMAIL_PUSH_AUDIENCE is unset
  // we run unauthenticated — matching the subscription's default state
  // before "Enable authentication" is flipped on. Once the env var is set,
  // we reject any request that fails verification with 401 so Pub/Sub
  // surfaces the misconfiguration in its delivery metrics.
  if (process.env.GMAIL_PUSH_AUDIENCE) {
    const authHeader = getHeader(event, "authorization") || "";
    try {
      await verifyPubSubToken(authHeader);
    } catch (err: any) {
      console.warn(`[gmail-push] OIDC verify failed: ${err.message}`);
      setResponseStatus(event, 401);
      return { ok: false, error: "unauthorized" };
    }
  }

  let body: any;
  try {
    body = await readBody(event);
  } catch {
    console.warn("[gmail-push] malformed body");
    return { ok: true };
  }

  const encoded = body?.message?.data;
  if (typeof encoded !== "string") {
    console.warn("[gmail-push] missing message.data");
    return { ok: true };
  }

  let payload: { emailAddress?: string; historyId?: string };
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    payload = JSON.parse(decoded);
  } catch {
    console.warn("[gmail-push] failed to decode/parse message.data");
    return { ok: true };
  }

  const emailAddress = payload.emailAddress;
  const historyId = payload.historyId;
  if (!emailAddress) {
    console.warn("[gmail-push] payload missing emailAddress");
    return { ok: true };
  }

  try {
    const accounts = await listOAuthAccounts("google");
    const match = accounts.find((a: any) => a.accountId === emailAddress);
    const owner =
      match && "owner" in match && typeof (match as any).owner === "string"
        ? ((match as any).owner as string)
        : undefined;

    bumpHistoryWatermark(emailAddress, historyId);
    if (owner) invalidateListCacheForOwner(owner);
  } catch (err: any) {
    console.warn(`[gmail-push] processing failed: ${err.message}`);
  }

  return { ok: true };
});
