import { setResponseHeader, setResponseStatus, type H3Event } from "h3";

const CONTEXT_KEY = "__anCredentialMembershipUnavailable";

export const CREDENTIAL_MEMBERSHIP_UNAVAILABLE_MESSAGE =
  "Organization membership could not be verified. Retry shortly.";

/**
 * Records that this request's bearer token verified but its organization
 * membership could not be checked. Such a request has no session, but it is
 * not unauthenticated: answer a retryable 503, never a 401 that tells the
 * client to sign in again.
 */
export function markCredentialMembershipUnavailable(event: H3Event): void {
  const holder = event as { context?: Record<string, unknown> };
  (holder.context ??= {})[CONTEXT_KEY] = true;
}

export function isCredentialMembershipUnavailable(event: H3Event): boolean {
  return (
    (event.context as Record<string, unknown> | undefined)?.[CONTEXT_KEY] ===
    true
  );
}

export function respondCredentialMembershipUnavailable(event: H3Event): {
  error: string;
} {
  setResponseStatus(event, 503);
  setResponseHeader(event, "Retry-After", "5");
  return { error: CREDENTIAL_MEMBERSHIP_UNAVAILABLE_MESSAGE };
}
