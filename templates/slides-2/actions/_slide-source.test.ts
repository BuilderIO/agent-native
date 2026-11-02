import { describe, expect, it } from "vitest";

import { repairedSlideId } from "../shared/slide-ids.js";
import { readStoredSlideSource } from "./_slide-source.js";

describe("readStoredSlideSource", () => {
  // oracle-change: a duplicate ID now resolves the way get-deck reports it, so
  // the repaired ID an outside agent read names the same slide here.
  it("resolves duplicate IDs the way get-deck reports them", () => {
    const first = "export default function Slide() { return <div />; }";
    const second = "export default function Slide() { return <p />; }";
    const rawData = JSON.stringify({
      slides: [
        { id: "slide-1", sourceTsx: first },
        { id: "slide-1", sourceTsx: second },
      ],
    });

    expect(
      readStoredSlideSource("deck-1", rawData, "slide-1").slide.sourceTsx,
    ).toBe(first);
    const repaired = readStoredSlideSource(
      "deck-1",
      rawData,
      repairedSlideId("deck-1", 1, 0),
    );
    expect(repaired.slide.sourceTsx).toBe(second);
    expect(repaired.position).toBe(1);
  });
});
