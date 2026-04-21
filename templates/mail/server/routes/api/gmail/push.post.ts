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

  // Pin to the specific service account Pub/Sub signs as. Without this any
  // Google-issued token with the right audience (e.g. a different GCP
  // project) would pass verification and spoof mailbox updates. Required
  // whenever OIDC auth is on.
  const expectedSigner = process.env.GMAIL_PUSH_SIGNER_EMAIL;
  if (!expectedSigner) {
    throw new Error("GMAIL_PUSH_SIGNER_EMAIL not configured");
  }
  if (payload.email !== expectedSigner) {
    throw new Error(`unexpected signer: ${payload.email}`);
  }

  return payload;
}

export default defineEventHandler(async (event: H3Event) => {
  // Fail closed when watches are enabled. If GMAIL_WATCH_TOPIC is set we are
  // actively subscribing for push notifications, so the endpoint MUST verify
  // incoming payloads — otherwise any public caller can post forged
  // historyId bumps and force the server into garbage-hydrate loops. OIDC
  // verification is keyed off GMAIL_PUSH_AUDIENCE; both must be configured
  // together. Without GMAIL_WATCH_TOPIC (watches disabled) we accept
  // unauthenticated pushes as a no-op pathway for local/dev testing.
  const watchesEnabled = !!process.env.GMAIL_WATCH_TOPIC;
  const audience = process.env.GMAIL_PUSH_AUDIENCE;
  if (watchesEnabled && !audience) {
    console.error(
      "[gmail-push] GMAIL_WATCH_TOPIC set but GMAIL_PUSH_AUDIENCE missing — rejecting to avoid unauthenticated push processing",
    );
    setResponseStatus(event, 503);
    return { ok: false, error: "push auth not configured" };
  }
  if (audience) {
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
