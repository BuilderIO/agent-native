import { listOAuthAccounts } from "@agent-native/core/oauth-tokens";
import {
  defineEventHandler,
  readBody,
  getHeader,
  setResponseStatus,
  type H3Event,
} from "h3";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import {
  bumpHistoryWatermark,
  invalidateListCacheForOwner,
} from "../../../lib/google-auth.js";
import { recordInboxPushInvalidation } from "../../../lib/inbox-store.js";

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

  const expectedSigner = process.env.GMAIL_PUSH_SIGNER_EMAIL;
  if (!expectedSigner) {
    throw new Error("GMAIL_PUSH_SIGNER_EMAIL not configured");
  }
  if (payload.email !== expectedSigner) {
    throw new Error(`unexpected signer: ${String(payload.email)}`);
  }

  return payload;
}

export default defineEventHandler(async (event: H3Event) => {
  const audience = process.env.GMAIL_PUSH_AUDIENCE;
  if (!audience) {
    setResponseStatus(event, 503);
    return { ok: false, error: "push endpoint disabled" };
  }
  const authHeader = getHeader(event, "authorization") || "";
  try {
    await verifyPubSubToken(authHeader);
  } catch (err: any) {
    console.warn(`[gmail-push] OIDC verify failed: ${err.message}`);
    setResponseStatus(event, 401);
    return { ok: false, error: "unauthorized" };
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
    if (owner) {
      invalidateListCacheForOwner(owner);
      await recordInboxPushInvalidation(owner, emailAddress);
    }
  } catch (err: any) {
    console.warn(`[gmail-push] processing failed: ${err.message}`);
    setResponseStatus(event, 500);
    return { ok: false, error: "processing failed" };
  }

  return { ok: true };
});
