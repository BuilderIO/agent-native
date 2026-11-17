const CLAIM_STORAGE_PREFIX = "design-visual-edit-board-claim:";

function claimStorageKey(designId: string): string {
  return `${CLAIM_STORAGE_PREFIX}${designId}`;
}

// The secret is a bearer credential for moving the board into an account, so
// it lives in this tab's sessionStorage, which other tabs and later visitors
// on the origin cannot read. The sign-in return flow, OAuth redirects
// included, stays in this tab, as does the board's own embed capability.

/**
 * Keep the claim secret for a board this tab built signed out. Without
 * storage the board still works; after sign-in it is copied instead of moved.
 */
export function storeVisualEditBoardClaimSecret(
  designId: string,
  secret: string,
): void {
  try {
    window.sessionStorage.setItem(claimStorageKey(designId), secret);
    // coercion-ok: storage is optional; without it sign-in copies the board instead of moving it.
  } catch {
    // Sign-in falls back to copying the board into the account.
  }
}

export type StoredBoardClaim =
  | { status: "found"; secret: string }
  | { status: "absent" }
  | { status: "unreadable" };

export function readVisualEditBoardClaimSecret(
  designId: string,
): StoredBoardClaim {
  try {
    const secret = window.sessionStorage.getItem(claimStorageKey(designId));
    return secret ? { status: "found", secret } : { status: "absent" };
  } catch {
    return { status: "unreadable" };
  }
}

export function clearVisualEditBoardClaimSecret(designId: string): void {
  try {
    window.sessionStorage.removeItem(claimStorageKey(designId));
    // coercion-ok: unavailable storage holds no secret to clear.
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
