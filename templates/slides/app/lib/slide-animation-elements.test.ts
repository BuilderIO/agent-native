// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  getSlideAnimationTargetKey,
  getSlideAnimationTargetPreview,
  parseSlideAnimationElements,
} from "@/lib/slide-animation-elements";

const contentSlide = `<div class="fmd-slide" style="padding: 80px 110px; justify-content: center;">
  <div style="font-size: 16px;">SECTION</div>
  <div style="font-size: 40px;">Slide Title</div>
  <div style="display: flex; flex-direction: column; gap: 16px;">
    <div style="display: flex; align-items: baseline; gap: 20px;"><span>•</span><span>First point</span></div>
    <div style="display: flex; align-items: baseline; gap: 20px;"><span>•</span><span>Second point</span></div>
    <div style="display: flex; align-items: baseline; gap: 20px;"><span>•</span><span>Third point</span></div>
  </div>
</div>`;

const titleSlide = `<div class="fmd-slide" style="padding: 80px 110px; justify-content: space-between;">
  <div>
    <div>Deck</div>
  </div>
  <div>
    <div>Presentation Title</div>
  </div>
  <div>
    <div>Your Name</div>
    <div>Date</div>
  </div>
</div>`;

describe("slide animation element parsing", () => {
  it("exposes top-level copy and nested bullets as animatable elements", () => {
    const elements = parseSlideAnimationElements(contentSlide);

    expect(elements.map((element) => element.preview)).toEqual([
      "SECTION",
      "Slide Title",
      "•First point",
      "•Second point",
      "•Third point",
    ]);
  });

  it("does not collapse nested title-slide groups to only the final wrapper", () => {
    const elements = parseSlideAnimationElements(titleSlide);

    expect(elements.map((element) => element.preview)).toEqual([
      "Deck",
      "Presentation Title",
      "Your Name",
      "Date",
    ]);
  });

  it("resolves old elementIndex animations through the legacy container", () => {
    expect(
      getSlideAnimationTargetPreview(contentSlide, {
        elementIndex: 0,
      }),
    ).toBe("•First point");
    expect(
      getSlideAnimationTargetKey(contentSlide, {
        elementIndex: 0,
      }),
    ).toBe("2.0");
  });

  it("resolves new elementPath animations to any nested element", () => {
    expect(
      getSlideAnimationTargetPreview(titleSlide, {
        elementIndex: 1,
        elementPath: [1, 0],
      }),
    ).toBe("Presentation Title");
    expect(
      getSlideAnimationTargetKey(titleSlide, {
        elementIndex: 1,
        elementPath: [1, 0],
      }),
    ).toBe("1.0");
  });

  it("includes empty styled shapes without exposing styled layout wrappers", () => {
    const elements = parseSlideAnimationElements(`<div class="fmd-slide">
      <div style="display: flex; gap: 20px; width: 100%;">
        <div style="width: 60px; height: 4px; background: #00E5FF;"></div>
        <p>Quote text</p>
      </div>
    </div>`);

    expect(elements.map((element) => element.preview)).toEqual([
      "Element 1",
      "Quote text",
    ]);
    expect(elements.map((element) => element.path)).toEqual([
      [0, 0],
      [0, 1],
    ]);
  });
});
