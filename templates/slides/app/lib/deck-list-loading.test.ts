import { describe, expect, it } from "vitest";

import { deckListViewState } from "./deck-list-loading";

describe("deckListViewState", () => {
  it("stays on the skeleton while the read is in flight, whatever the other inputs say", () => {
    expect(
      deckListViewState({ loading: true, loadError: false, deckCount: 0 }),
    ).toBe("loading");
    expect(
      deckListViewState({ loading: true, loadError: true, deckCount: 0 }),
    ).toBe("loading");
    expect(
      deckListViewState({ loading: true, loadError: false, deckCount: 3 }),
    ).toBe("loading");
  });

  it("prefers the error pane over the empty state once the read settles", () => {
    expect(
      deckListViewState({ loading: false, loadError: true, deckCount: 0 }),
    ).toBe("error");
  });

  it("keeps already-loaded decks visible when a refresh fails", () => {
    expect(
      deckListViewState({ loading: false, loadError: true, deckCount: 1 }),
    ).toBe("decks");
  });

  it("reports empty only for a settled, error-free zero", () => {
    expect(
      deckListViewState({ loading: false, loadError: false, deckCount: 0 }),
    ).toBe("empty");
  });

  it("renders decks as soon as there are any", () => {
    expect(
      deckListViewState({ loading: false, loadError: false, deckCount: 2 }),
    ).toBe("decks");
  });
});
