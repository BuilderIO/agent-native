import { fail } from "@agent-native/core/action";

import { isSlides2DeckData } from "../shared/deck-app-scope.js";

export { isSlides2DeckData };

export function assertSlides2DeckData(data: unknown): void {
  if (!isSlides2DeckData(data)) {
    fail("Deck not found.", {
      errorCode: "deck_not_found",
      statusCode: 404,
    });
  }
}

export function assertSlides2CreatePayload(data: unknown): void {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    fail("Deck not found.", {
      errorCode: "deck_not_found",
      statusCode: 404,
    });
  }
  const deck = data as Record<string, unknown>;
  if (Object.hasOwn(deck, "appId") && deck.appId !== "slides-2") {
    fail("Deck not found.", {
      errorCode: "deck_not_found",
      statusCode: 404,
    });
  }
}
