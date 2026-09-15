import { describe, expect, it } from "vitest";

import { deckContrastCoverage } from "./deck-contrast";

const unreadable = (id: string) => ({
  id,
  content: `<div class="fmd-slide" style="background: #FEF7FF;"><h1 style="color: #FFFBFE;">${id}</h1></div>`,
});

const readable = (id: string) => ({
  id,
  content: `<div class="fmd-slide" style="background: #FEF7FF;"><h1 style="color: #1D1B20;">${id}</h1></div>`,
});

describe("deckContrastCoverage", () => {
  it("adds no field to a readable deck", () => {
    expect(
      deckContrastCoverage([readable("a"), readable("b"), readable("c")]),
    ).toBeNull();
  });

  it("names every slide still failing, not just the first", () => {
    const coverage = deckContrastCoverage([
      readable("slide-1"),
      unreadable("slide-2"),
      readable("slide-3"),
      unreadable("slide-4"),
      unreadable("slide-5"),
    ]);

    expect(coverage).not.toBeNull();
    expect(coverage!.complete).toBe(false);
    expect(coverage!.unreadableSlideIds).toEqual([
      "slide-2",
      "slide-4",
      "slide-5",
    ]);
    expect(coverage!.unreadableSlideNumbers).toEqual([2, 4, 5]);
  });

  it("clears once a partial fix pass is completed", () => {
    const partiallyFixed = [
      readable("slide-1"),
      readable("slide-2"),
      unreadable("slide-3"),
    ];
    expect(deckContrastCoverage(partiallyFixed)!.unreadableSlideIds).toEqual([
      "slide-3",
    ]);

    const fullyFixed = [
      readable("slide-1"),
      readable("slide-2"),
      readable("slide-3"),
    ];
    expect(deckContrastCoverage(fullyFixed)).toBeNull();
  });

  it("says a pending layout check is not a reason to skip a slide", () => {
    const coverage = deckContrastCoverage([unreadable("slide-1")]);
    expect(coverage!.guidance).toContain("layoutFit");
    expect(coverage!.guidance).toContain("never a reason");
  });

  it("reads a slide background stored outside the HTML", () => {
    const html = `<div class="fmd-slide"><h1 style="color: #FFFBFE;">Moon</h1></div>`;

    expect(
      deckContrastCoverage([
        { id: "s1", content: html, background: "#FEF7FF" },
      ]),
    ).not.toBeNull();
    expect(
      deckContrastCoverage([
        { id: "s1", content: html, background: "#0B0E14" },
      ]),
    ).toBeNull();
  });

  it("checks a slide that inherits the linked design system's canvas", () => {
    // No background anywhere in the slide: the renderer paints it on the
    // system's canvas, so the audit has to use that or the slide is invisible.
    const html = `<div class="fmd-slide"><h1 style="color: #FFFBFE;">Moon</h1></div>`;

    expect(deckContrastCoverage([{ id: "s1", content: html }])).toBeNull();
    expect(
      deckContrastCoverage([{ id: "s1", content: html }], "#FEF7FF")!
        .unreadableSlideIds,
    ).toEqual(["s1"]);
    expect(
      deckContrastCoverage([{ id: "s1", content: html }], "#0B0E14"),
    ).toBeNull();
  });

  it("lets an explicit slide background win over the inherited canvas", () => {
    const html = `<div class="fmd-slide"><h1 style="color: #FFFBFE;">Moon</h1></div>`;

    expect(
      deckContrastCoverage(
        [{ id: "s1", content: html, background: "bg-[#0B0E14]" }],
        "#FEF7FF",
      ),
    ).toBeNull();
  });

  it("skips empty slides instead of reporting them as unreadable", () => {
    expect(deckContrastCoverage([{ id: "blank", content: "" }])).toBeNull();
  });
});
