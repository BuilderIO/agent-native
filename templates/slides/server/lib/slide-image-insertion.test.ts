import { describe, expect, it } from "vitest";

import {
  insertImageIntoSlideHtml,
  slideHtmlContainsImageSource,
} from "./slide-image-insertion.js";

describe("insertImageIntoSlideHtml", () => {
  it("replaces the first placeholder while retaining its layout style", () => {
    const result = insertImageIntoSlideHtml(
      '<div class="fmd-slide"><div class="fmd-img-placeholder" style="width: 48%; height: 280px;">Hero visual</div></div>',
      "https://cdn.example.com/hero.png",
    );

    expect(result).toContain('src="https://cdn.example.com/hero.png"');
    expect(result).toContain('alt="Hero visual"');
    expect(result).toContain(
      'style="width: 48%; height: 280px; display: block; object-fit: cover; min-width: 0;"',
    );
    expect(result).not.toContain("fmd-img-placeholder");
  });

  it("adds a full-bleed layer behind slide content when no placeholder exists", () => {
    const result = insertImageIntoSlideHtml(
      '<div class="fmd-slide"><h1>Quarterly update</h1></div>',
      "https://cdn.example.com/background.png",
      { alt: "Quarterly background" },
    );

    expect(result).toContain('class="fmd-img-uploaded"');
    expect(result).toContain(
      'style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: -1;"',
    );
    expect(result).toContain('class="fmd-slide" style="position: relative;"');
    expect(result.indexOf("fmd-img-uploaded")).toBeLessThan(
      result.indexOf("<h1>"),
    );
  });

  it("recognizes the persisted image source after attribute escaping", () => {
    const url = "https://cdn.example.com/image?label=Tom&Jerry";
    const result = insertImageIntoSlideHtml("<div>Slide</div>", url);

    expect(slideHtmlContainsImageSource(result, url)).toBe(true);
  });
});
