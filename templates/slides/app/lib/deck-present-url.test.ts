import { describe, expect, it } from "vitest";

import {
  buildPresentUrl,
  PRESENTER_WINDOW_FEATURES,
  presenterWindowName,
} from "./deck-present-url";

describe("buildPresentUrl", () => {
  it("opens the deck at a one-based slide and leaves fullscreen to the page", () => {
    expect(buildPresentUrl("deck-1", 0)).toBe("/deck/deck-1/present?slide=1");
    expect(buildPresentUrl("deck-1", 4, "fullscreen")).toBe(
      "/deck/deck-1/present?slide=5",
    );
  });

  it("asks the page not to take fullscreen when presenting in the tab", () => {
    expect(buildPresentUrl("deck-1", 1, "window")).toBe(
      "/deck/deck-1/present?slide=2&fullscreen=0",
    );
  });

  it("addresses the presenter view window", () => {
    expect(buildPresentUrl("deck-1", 1, "presenter")).toBe(
      "/deck/deck-1/present?slide=2&presenter=1",
    );
  });

  it("starts at the first slide when the current index is not known yet", () => {
    expect(buildPresentUrl("deck-1", -1)).toBe("/deck/deck-1/present?slide=1");
  });
});

describe("presenter window", () => {
  it("is named per deck so starting it again reuses the open window", () => {
    expect(presenterWindowName("deck-1")).toBe("slides-presenter-deck-1");
    expect(presenterWindowName("deck-2")).not.toBe(
      presenterWindowName("deck-1"),
    );
    expect(PRESENTER_WINDOW_FEATURES).toContain("width=");
  });
});
