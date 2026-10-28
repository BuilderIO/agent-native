import { describe, expect, it } from "vitest";

import { parsePartialAddSlideInput } from "./streaming-slide-html";

describe("parsePartialAddSlideInput", () => {
  it("recovers escaped slide HTML while the JSON argument is incomplete", () => {
    expect(
      parsePartialAddSlideInput(
        '{"deckId":"deck-1","content":"<div class=\\"fmd-slide\\"><h1>Live',
      ),
    ).toEqual({
      deckId: "deck-1",
      content: '<div class="fmd-slide"><h1>Live',
    });
  });

  it("uses the complete JSON value when the action input is finished", () => {
    expect(
      parsePartialAddSlideInput(
        JSON.stringify({
          deckId: "deck-1",
          content: '<div class="fmd-slide">Done</div>',
        }),
      ),
    ).toEqual({
      deckId: "deck-1",
      content: '<div class="fmd-slide">Done</div>',
    });
  });
});
