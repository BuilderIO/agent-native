import { describe, expect, it } from "vitest";

import { readStoredSlideSource } from "./_slide-source.js";

describe("readStoredSlideSource", () => {
  it("rejects a persisted deck with duplicate IDs for the requested slide", () => {
    const sourceTsx = "export default function Slide() { return <div />; }";
    const rawData = JSON.stringify({
      slides: [
        { id: "slide-1", sourceTsx },
        { id: "slide-1", sourceTsx },
      ],
    });

    let error: unknown;
    try {
      readStoredSlideSource(rawData, "slide-1");
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      errorCode: "duplicate_deck_slide_ids",
      statusCode: 409,
      details: { slideId: "slide-1" },
    });
  });
});
