import { setResponseStatus, type H3Event } from "h3";

/**
 * Why a presented bearer token was refused. `invalid` covers every token
 * nothing here could verify. The others describe a credential this app issued
 * and verified, so its holder has proven possession and can act on the reason.
 */
export type BearerCredentialRefusal =
  | "invalid"
  | "revoked"
  | "unknown-connect-token"
  | "identity-mismatch"
  | "not-member"
  | "email-retired";

const CONTEXT_KEY = "__anBearerCredentialRefusal";

/**
 * One sentence naming the refusal. It travels in a `WWW-Authenticate`
 * `error_description`, so it must stay printable ASCII without `"` or `\`.
 */
export function describeBearerCredentialRefusal(
  refusal: BearerCredentialRefusal,
): string {
  switch (refusal) {
    case "revoked":
      return "This token was revoked.";
    case "unknown-connect-token":
      return "This app has no record of this connect token: another deployment minted it, or its record was deleted.";
    case "identity-mismatch":
      return "This connect token does not match the account it was issued to.";
    case "not-member":
      return "This token's account is no longer a member of the organization it was issued for.";
    case "email-retired":
      return "This token was issued to an email address the account no longer uses.";
    case "invalid":
      return "This bearer token could not be verified: it is malformed, expired, issued for another app, or older than a required reconnect.";
  }
}

/** RFC 6750 `error_description` characters: printable ASCII except `"` and `\`. */
const ERROR_DESCRIPTION_CHARACTERS = /^[\x20\x21\x23-\x5B\x5D-\x7E]*$/;

/**
 * The connect URL serialized as an ASCII URL, or undefined when it still could
 * not travel in an `error_description`. Its host comes from request headers
 * and its base path from configuration, so neither is trusted to be safe.
 */
function headerSafeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  let href: string;
  try {
    href = new URL(url).href;
  } catch {
    // coercion-ok: an unparseable connect URL is left out of the hint, which then names no URL.
    return undefined;
  }
  return ERROR_DESCRIPTION_CHARACTERS.test(href) ? href : undefined;
}

export function describeBearerCredentialRefusalWithRecovery(
  refusal: BearerCredentialRefusal,
  connectUrl: string | undefined,
): string {
  const url = headerSafeUrl(connectUrl);
  const recovery = url ? `Reconnect at ${url}.` : "Reconnect this connector.";
  return `${describeBearerCredentialRefusal(refusal)} ${recovery}`;
}

/**
 * Records why this request's bearer token was refused, so the auth guard's
 * 401 says why instead of a bare `Unauthorized`.
 */
export function markBearerCredentialRefused(
  event: H3Event,
  refusal: BearerCredentialRefusal,
  connectUrl: string | undefined,
): void {
  const holder = event as { context?: Record<string, unknown> };
  (holder.context ??= {})[CONTEXT_KEY] = {
    reason: refusal,
    message: describeBearerCredentialRefusalWithRecovery(refusal, connectUrl),
  };
}

export function respondBearerCredentialRefused(
  event: H3Event,
): { error: string; reason: BearerCredentialRefusal; message: string } | null {
  const refused = (event.context as Record<string, unknown> | undefined)?.[
    CONTEXT_KEY
  ] as { reason: BearerCredentialRefusal; message: string } | undefined;
  if (!refused) return null;
  setResponseStatus(event, 401);
  return { error: "Unauthorized", ...refused };
}
