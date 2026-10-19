import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { describe, expect, it } from "vitest";

import { readAppStateForCurrentTab } from "./_tab-state.js";

const sentFromSlideOne = {
  source: "message" as const,
  snapshot: {
    v: 1 as const,
    browserTabId: "tab-a",
    capturedAt: 1,
    values: {
      navigation: { view: "editor", deckId: "deck-1", slideIndex: 0 },
      "slides-selection": {
        deckId: "deck-1",
        slideId: "slide-1",
        items: [{ objectId: "title" }],
      },
      selection: null,
    },
  },
};

function inTurn<T>(fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext(
    {
      userEmail: "owner@example.com",
      run: { browserTabId: "tab-a", turnScreen: sentFromSlideOne },
    },
    fn,
  ) as Promise<T>;
}

describe("Slides screen reads during a turn", () => {
  it("see the slide and selection the message was sent from", async () => {
    const [navigation, selection] = await inTurn(() =>
      Promise.all([
        readAppStateForCurrentTab("navigation"),
        readAppStateForCurrentTab("slides-selection", {
          fallbackToGlobal: false,
        }),
      ]),
    );

    expect(navigation).toEqual(sentFromSlideOne.snapshot.values.navigation);
    expect(selection).toEqual(
      sentFromSlideOne.snapshot.values["slides-selection"],
    );
  });

  it("keep an empty sent selection empty instead of falling back to the global key", async () => {
    expect(await inTurn(() => readAppStateForCurrentTab("selection"))).toBe(
      null,
    );
  });
});
