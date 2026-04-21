import { defineEventHandler, readBody, type H3Event } from "h3";
import { listOAuthAccounts } from "@agent-native/core/oauth-tokens";
import {
  bumpHistoryWatermark,
  invalidateListCacheForOwner,
} from "../../../lib/google-auth.js";

// TODO: verify the Pub/Sub OIDC token on inbound requests before trusting the
// payload. See
// https://cloud.google.com/pubsub/docs/push#authentication_and_authorization_by_the_push_endpoint
export default defineEventHandler(async (event: H3Event) => {
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
