import { describe, expect, it } from "vitest";

import { getDeckShareLinkOrder } from "@/lib/deck-share-links";

describe("getDeckShareLinkOrder", () => {
  it("makes the read-only presentation link primary for public decks", () => {
    expect(getDeckShareLinkOrder("public")).toEqual({
      primary: "presentation",
      secondary: "editor",
    });
  });

  it.each(["private", "org", undefined] as const)(
    "keeps the editor link primary for %s decks",
    (visibility) => {
      expect(getDeckShareLinkOrder(visibility)).toEqual({
        primary: "editor",
        secondary: "presentation",
      });
    },
  );
});
