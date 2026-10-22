import { describe, expect, it } from "vitest";

import { isSlidesPdfSidecar, type SlidesPdfSidecar } from "./pdf-sidecar";

function sidecar(slides: Array<Record<string, unknown>>): SlidesPdfSidecar {
  return { v: 1, slides } as unknown as SlidesPdfSidecar;
}

describe("isSlidesPdfSidecar transitions", () => {
  it("accepts a catalog transition with an in-range speed", () => {
    const payload = sidecar([
      { content: "<p>a</p>", transition: "cube", transitionSpeed: 12 },
    ]);
    expect(isSlidesPdfSidecar(payload)).toBe(true);
    expect(payload.slides[0]).toMatchObject({
      transition: "cube",
      transitionSpeed: 12,
    });
  });

  it.each([
    ["instant", "none"],
    ["slide", "slide-from-right"],
    ["zoom", "dissolve"],
  ])("rewrites legacy transition %s to canonical %s", (legacy, canonical) => {
    const payload = sidecar([{ content: "<p>a</p>", transition: legacy }]);
    expect(isSlidesPdfSidecar(payload)).toBe(true);
    expect(payload.slides[0]?.transition).toBe(canonical);
  });

  it("rejects a transition outside the catalog", () => {
    expect(
      isSlidesPdfSidecar(
        sidecar([{ content: "<p>a</p>", transition: "bounce" }]),
      ),
    ).toBe(false);
  });

  it.each([50, -1, 2.5])("rejects transitionSpeed %s", (transitionSpeed) => {
    expect(
      isSlidesPdfSidecar(
        sidecar([{ content: "<p>a</p>", transition: "fade", transitionSpeed }]),
      ),
    ).toBe(false);
  });

  it("leaves legacy values untouched when another slide fails validation", () => {
    const payload = sidecar([
      { content: "<p>a</p>", transition: "zoom" },
      { content: "<p>b</p>", transition: "bounce" },
    ]);
    expect(isSlidesPdfSidecar(payload)).toBe(false);
    expect(payload.slides[0]?.transition).toBe("zoom");
  });
});
