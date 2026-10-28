export type ClipVisibility = "private" | "org" | "public";

export function isPrivateClip(
  visibility: ClipVisibility | (string & {}) | null | undefined,
): boolean {
  return visibility === "private";
}
