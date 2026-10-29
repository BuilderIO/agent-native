export const SLIDES_ACCESS_REQUEST_TOKEN_PREFIX = "slides-access-request";
export const SLIDES_ACCESS_REQUEST_FALLBACK_TOKEN_PREFIX =
  "slides-access-request-fallback";
export const SLIDES_ACCESS_REQUEST_TOKEN_TTL_SECONDS = 10 * 60;
export const SLIDES_ACCESS_REQUEST_NOTE_MAX_LENGTH = 500;

export const SLIDES_ACCESS_APPROVAL_TOKEN_PREFIX = "slides-access-approval";
export const SLIDES_ACCESS_APPROVAL_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
export const SLIDES_ACCESS_APPROVAL_SESSION_KEY_PREFIX =
  "slides-access-approval-token:";

export function deckAccessApprovalPath(
  deckId: string,
  approvalToken: string,
): string {
  const params = new URLSearchParams({ deckId, token: approvalToken });
  return `/access-request/approve?${params.toString()}`;
}

export function deckAccessApprovalContinuationPath(deckId: string): string {
  return `/access-request/approve?${new URLSearchParams({ deckId }).toString()}`;
}

export function deckAccessApprovalSessionKey(deckId: string): string {
  return `${SLIDES_ACCESS_APPROVAL_SESSION_KEY_PREFIX}${encodeURIComponent(deckId)}`;
}

/** The roles an access request can ask for, and an approval can grant. */
export const DECK_ACCESS_REQUEST_ROLES = ["viewer", "editor"] as const;
export type DeckAccessRequestRole = (typeof DECK_ACCESS_REQUEST_ROLES)[number];

const DECK_ROLE_RANK = {
  viewer: 0,
  commenter: 1,
  editor: 2,
  admin: 3,
  owner: 4,
} as const;

/** Whether someone holding `role` on a deck already has `requested`. */
export function deckRoleCovers(
  role: string,
  requested: DeckAccessRequestRole,
): boolean {
  return (
    Object.hasOwn(DECK_ROLE_RANK, role) &&
    DECK_ROLE_RANK[role as keyof typeof DECK_ROLE_RANK] >=
      DECK_ROLE_RANK[requested]
  );
}
