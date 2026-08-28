import crypto from "node:crypto";

import {
  createBetterAuthSessionForEmail,
  getAuthSecret,
  type BetterAuthInstance,
} from "./better-auth-instance.js";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Adapt a framework-authenticated action request for Better Auth APIs that
 * require a Better Auth session. The caller must already have resolved the
 * framework identity into `email`; this helper never authenticates a request.
 */
export async function getBetterAuthActionHeaders(
  auth: BetterAuthInstance,
  email: string,
  requestHeaders: Headers,
): Promise<Headers> {
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (session) {
    if (normalizeEmail(session.user.email) !== normalizeEmail(email)) {
      throw new Error("Better Auth session identity mismatch.");
    }
    return requestHeaders;
  }

  const sessionForAction = await createBetterAuthSessionForEmail(email);
  if (!sessionForAction) return requestHeaders;
  if (normalizeEmail(sessionForAction.email) !== normalizeEmail(email)) {
    throw new Error("Better Auth session identity mismatch.");
  }

  const signature = crypto
    .createHmac("sha256", getAuthSecret())
    .update(sessionForAction.token)
    .digest("base64url");
  const headers = new Headers(requestHeaders);
  headers.set("authorization", `Bearer ${sessionForAction.token}.${signature}`);
  return headers;
}
