import { describe, expect, it } from "vitest";

import {
  getDeckChatScopeLabel,
  getEffectiveSlidesSidebarCollapsed,
  isSlidesEditorRoute,
} from "./layout-route-policy";

describe("Slides layout sidebar route policy", () => {
  it("uses a contextual label for untitled deck chat scope", () => {
    expect(getDeckChatScopeLabel("Untitled Deck", "This Deck")).toBe(
      "This Deck",
    );
    expect(getDeckChatScopeLabel("Quarterly Review", "This Deck")).toBe(
      "Quarterly Review",
    );
    expect(getDeckChatScopeLabel(undefined, "This Deck")).toBe("");
  });

  it("recognizes only deck editor routes", () => {
    expect(isSlidesEditorRoute("/deck/deck-1")).toBe(true);
    expect(isSlidesEditorRoute("/deck/deck-1/")).toBe(true);
    expect(isSlidesEditorRoute("/")).toBe(false);
    expect(isSlidesEditorRoute("/deck/deck-1/present")).toBe(false);
  });

  it("collapses app navigation by default in the deck editor", () => {
    expect(
      getEffectiveSlidesSidebarCollapsed({
        pathname: "/deck/deck-1",
        persistedCollapsed: false,
      }),
    ).toBe(true);
  });

  it("respects a user override while editing", () => {
    expect(
      getEffectiveSlidesSidebarCollapsed({
        pathname: "/deck/deck-1",
        persistedCollapsed: false,
        editorOverride: false,
      }),
    ).toBe(false);
  });

  it("uses the persisted preference outside the editor", () => {
    expect(
      getEffectiveSlidesSidebarCollapsed({
        pathname: "/design-systems",
        persistedCollapsed: false,
      }),
    ).toBe(false);
    expect(
      getEffectiveSlidesSidebarCollapsed({
        pathname: "/design-systems",
        persistedCollapsed: true,
      }),
    ).toBe(true);
  });
});
