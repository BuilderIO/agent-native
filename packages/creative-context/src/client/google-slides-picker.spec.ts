import { describe, expect, it } from "vitest";

import { googleSlidesPickerSelections } from "./google-slides-picker.js";

describe("googleSlidesPickerSelections", () => {
  it("returns unique presentation ids with safe canonical URLs", () => {
    expect(
      googleSlidesPickerSelections({
        docs: [
          {
            id: "deck_123456789",
            name: "Launch",
            url: "https://attacker.example/x",
          },
          { id: "deck_123456789", name: "Duplicate" },
          { id: "deck_987654321", name: "Roadmap" },
          { id: "bad/id", name: "Invalid id" },
          { name: "Missing id" },
        ],
      }),
    ).toEqual([
      {
        externalId: "deck_123456789",
        title: "Launch",
        canonicalUrl:
          "https://docs.google.com/presentation/d/deck_123456789/edit",
      },
      {
        externalId: "deck_987654321",
        title: "Roadmap",
        canonicalUrl:
          "https://docs.google.com/presentation/d/deck_987654321/edit",
      },
    ]);
  });
});
