export function isSlides2DeckData(data: unknown): boolean {
  let value = data;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return false;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const deck = value as Record<string, unknown>;
  return Object.hasOwn(deck, "appId") && deck.appId === "slides-2";
}
