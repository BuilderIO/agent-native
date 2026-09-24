/** Short-lived capability used by a private deck viewer to request access. */
export const SLIDES_ACCESS_REQUEST_TOKEN_PREFIX = "slides-access-request";
/** Capability used when the private-deck access probe is unavailable. */
export const SLIDES_ACCESS_REQUEST_FALLBACK_TOKEN_PREFIX =
  "slides-access-request-fallback";
export const SLIDES_ACCESS_REQUEST_TOKEN_TTL_SECONDS = 10 * 60;

/** Signed capability used by an owner to approve a private deck access request. */
export const SLIDES_ACCESS_APPROVAL_TOKEN_PREFIX = "slides-access-approval";
export const SLIDES_ACCESS_APPROVAL_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
export const SLIDES_ACCESS_APPROVAL_SESSION_KEY_PREFIX =
  "slides-access-approval-token:";

/** Owner-only route used by the one-click approval button in access emails. */
export function deckAccessApprovalPath(
  deckId: string,
  approvalToken: string,
): string {
  const params = new URLSearchParams({ deckId, token: approvalToken });
  return `/access-request/approve?${params.toString()}`;
}

/** Token-free continuation used after the approver signs in. */
export function deckAccessApprovalContinuationPath(deckId: string): string {
  return `/access-request/approve?${new URLSearchParams({ deckId }).toString()}`;
}

/** Tab-scoped key for carrying an approval token across the sign-in redirect. */
export function deckAccessApprovalSessionKey(deckId: string): string {
  return `${SLIDES_ACCESS_APPROVAL_SESSION_KEY_PREFIX}${encodeURIComponent(deckId)}`;
}
