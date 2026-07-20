export type ClipVisibility = "private" | "org" | "public";

export function isPrivateClip(
  visibility: ClipVisibility | string | null | undefined,
): boolean {
  return visibility === "private";
}

export function canAddRewindHistory(
  role: string | null | undefined,
  visibility: ClipVisibility | string | null | undefined,
): boolean {
  return role === "owner" && isPrivateClip(visibility);
}

export function canOfferRewindHistory(
  role: string | null | undefined,
): boolean {
  return role === "owner";
}

export function rewindHistoryUnavailableReason(
  role: string | null | undefined,
  visibility: ClipVisibility | string | null | undefined,
): string | undefined {
  if (role !== "owner") return "Only the owner can add Rewind history";
  if (visibility !== "private") {
    return "Make this Clip private before adding Rewind history";
  }
  return undefined;
}
