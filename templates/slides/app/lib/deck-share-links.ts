export type DeckShareLinkKind = "editor" | "presentation";

export function getDeckShareLinkOrder(
  visibility?: "private" | "org" | "public",
): { primary: DeckShareLinkKind; secondary: DeckShareLinkKind } {
  return visibility === "public"
    ? { primary: "presentation", secondary: "editor" }
    : { primary: "editor", secondary: "presentation" };
}
