import { describe, expect, it } from "vitest";

import {
  deckDataColumns,
  deckListColumns,
  MAX_PREVIEW_SLIDE_CHARS,
} from "./deck-list-columns.js";

describe("deck list columns", () => {
  it("stores the first slide, aspect ratio, and slide count beside the body", () => {
    const deck = {
      aspectRatio: "4:3",
      slides: [
        { id: "a", content: "<h1>A</h1>" },
        { id: "b", content: "<p>B</p>" },
      ],
    };

    expect(deckDataColumns(deck)).toEqual({
      data: JSON.stringify(deck),
      previewSlide: JSON.stringify(deck.slides[0]),
      previewTooLarge: false,
      aspectRatio: "4:3",
      slideCount: 2,
    });
  });

  it("marks an empty deck as computed so list reads never parse it", () => {
    expect(deckListColumns({ slides: [] })).toEqual({
      previewSlide: null,
      previewTooLarge: false,
      aspectRatio: null,
      slideCount: 0,
    });
    expect(deckListColumns(null).slideCount).toBe(0);
  });

  it("flags a first slide too large for a gallery page", () => {
    const columns = deckListColumns({
      slides: [{ id: "a", content: "x".repeat(MAX_PREVIEW_SLIDE_CHARS) }],
    });

    expect(columns).toMatchObject({
      previewSlide: null,
      previewTooLarge: true,
      slideCount: 1,
    });
  });
});
