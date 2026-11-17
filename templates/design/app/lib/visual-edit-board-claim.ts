const CLAIM_STORAGE_PREFIX = "design-visual-edit-board-claim:";

function claimStorageKey(designId: string): string {
  return `${CLAIM_STORAGE_PREFIX}${designId}`;
}

/**
 * Keep the claim secret for a board this tab built signed out. Without
 * storage the board still works; after sign-in it is copied instead of moved.
 */
export function storeVisualEditBoardClaimSecret(
  designId: string,
  secret: string,
): void {
  try {
    window.localStorage.setItem(claimStorageKey(designId), secret);
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
    const secret = window.localStorage.getItem(claimStorageKey(designId));
    return secret ? { status: "found", secret } : { status: "absent" };
  } catch {
    return { status: "unreadable" };
  }
}

export function clearVisualEditBoardClaimSecret(designId: string): void {
  try {
    window.localStorage.removeItem(claimStorageKey(designId));
    // coercion-ok: unavailable storage holds no secret to clear.
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
