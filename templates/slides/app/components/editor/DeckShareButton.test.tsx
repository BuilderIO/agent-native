// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/api-path", () => ({
  appPath: (path: string) => `/slides${path}`,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { useDeckShareLinks } from "./DeckShareButton";

describe("useDeckShareLinks", () => {
  it("leads with the live editor link for a private deck", () => {
    const { result } = renderHook(() =>
      useDeckShareLinks("deck-1", "private", true),
    );

    expect(result.current.primary?.url).toBe(
      `${window.location.origin}/slides/deck/deck-1`,
    );
    expect(result.current.secondary?.url).toBe(
      `${window.location.origin}/slides/p/deck-1`,
    );
  });

  it("leads with the presentation link once the deck is public", () => {
    const { result } = renderHook(() =>
      useDeckShareLinks("deck-1", "public", true),
    );

    expect(result.current.primary?.label).toBe(
      "editorToolbar.presentationLink",
    );
    expect(result.current.secondary?.label).toBe("editorToolbar.editorLink");
  });

  it.each(["private", "org", "public"] as const)(
    "shares the presentation route for a %s deck",
    (visibility) => {
      const { result } = renderHook(() =>
        useDeckShareLinks("deck-1", visibility, true),
      );
      const links = [result.current.primary, result.current.secondary];

      expect(
        links.find((link) => link?.label === "editorToolbar.presentationLink")
          ?.url,
      ).toBe(`${window.location.origin}/slides/p/deck-1`);
    },
  );

  it("omits the presentation link while the deck has no slides", () => {
    const { result } = renderHook(() =>
      useDeckShareLinks("deck-1", "public", false),
    );

    expect(result.current.primary).toBeUndefined();
    expect(result.current.secondary?.label).toBe("editorToolbar.editorLink");
  });
});
