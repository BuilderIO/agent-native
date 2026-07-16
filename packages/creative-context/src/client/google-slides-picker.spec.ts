import { describe, expect, it } from "vitest";

import { googleSlidesPickerSelections } from "./google-slides-picker.js";

describe("googleSlidesPickerSelections", () => {
  it("returns unique presentation ids with safe canonical URLs", () => {
    expect(
      googleSlidesPickerSelections({
        docs: [
          { id: "deck-1", name: "Launch", url: "https://drive.google.com/x" },
          { id: "deck-1", name: "Duplicate" },
          { id: "deck-2", name: "Roadmap", url: "javascript:alert(1)" },
          { name: "Missing id" },
        ],
      }),
    ).toEqual([
      {
        externalId: "deck-1",
        title: "Launch",
        canonicalUrl: "https://drive.google.com/x",
      },
      {
        externalId: "deck-2",
        title: "Roadmap",
        canonicalUrl: "https://docs.google.com/presentation/d/deck-2/edit",
      },
    ]);
  });
});
