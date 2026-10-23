import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/action", () => ({
  fail: (message: string, details: Record<string, unknown>) => {
    throw Object.assign(new Error(message), details);
  },
}));

import {
  assertSlides2CreatePayload,
  assertSlides2DeckData,
} from "./_deck-app-scope";

describe("Slides 2 deck app scope", () => {
  it("allows only decks explicitly owned by Slides 2", () => {
    expect(() =>
      assertSlides2DeckData({ appId: "slides-2", slides: [] }),
    ).not.toThrow();
  });

  it.each([{ slides: [] }, { appId: "slides", slides: [] }])(
    "hides non-Slides 2 deck data: %o",
    (data) => {
      expect(() => assertSlides2DeckData(data)).toThrow(
        expect.objectContaining({
          errorCode: "deck_not_found",
          statusCode: 404,
        }),
      );
    },
  );

  it.each([null, [], "not-json", undefined])(
    "fails closed for malformed deck data: %o",
    (data) => {
      expect(() => assertSlides2DeckData(data)).toThrow(
        expect.objectContaining({ errorCode: "deck_not_found" }),
      );
    },
  );

  it("allows an unmarked new payload that will be tagged before insert", () => {
    expect(() => assertSlides2CreatePayload({ slides: [] })).not.toThrow();
  });

  it("rejects a new payload explicitly owned by Slides", () => {
    expect(() =>
      assertSlides2CreatePayload({ appId: "slides", slides: [] }),
    ).toThrow(expect.objectContaining({ errorCode: "deck_not_found" }));
  });
});
