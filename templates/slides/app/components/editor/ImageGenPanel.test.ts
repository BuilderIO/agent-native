import { describe, expect, it } from "vitest";

import { buildImageGenerationContext } from "./ImageGenPanel";

describe("buildImageGenerationContext", () => {
  it("emits an explicit referenceImageUrls instruction for selected style refs", () => {
    const context = buildImageGenerationContext({
      prompt: "a warm editorial hero image",
      referenceImageUrls: [
        "https://cdn.example.com/style-1.png",
        "https://cdn.example.com/style-2.png",
      ],
      slideContext: {
        slideId: "slide-1",
        slideIndex: 0,
        slideContent: "<div>Headline</div>",
        slideLayout: "title",
        deckId: "deck-1",
        deckTitle: "Brand deck",
      },
    });

    expect(context).toContain(
      'Call `generate-image-api` with referenceImageUrls set to this exact array: ["https://cdn.example.com/style-1.png","https://cdn.example.com/style-2.png"].',
    );
    expect(context).toContain(
      'Target: Slide 1 (id: slide-1) in deck "Brand deck" (id: deck-1).',
    );
    expect(context).toContain(
      "Pass deckId, slideId, slideContent, and referenceImageUrls to the action so Assets can ground the generation in this slide.",
    );
  });
});
