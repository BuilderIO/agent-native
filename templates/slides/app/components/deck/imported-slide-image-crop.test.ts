// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

/**
 * happy-dom cannot expand Tailwind's `@apply`, so the utilities that
 * `.slide-content img` applies are restated here as the CSS Tailwind emits for
 * them (`max-w-full` → `max-width: 100%`, `max-h-[60vh]` → `max-height: 60vh`).
 * Without this stand-in the caps under test would not exist in the test
 * document at all and the assertions below would pass vacuously.
 */
const appliedUtilities = document.createElement("style");
appliedUtilities.textContent = `.slide-content img { max-width: 100%; max-height: 60vh; }`;

const stylesheet = document.createElement("style");
stylesheet.textContent = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../global.css"),
  "utf8",
);

beforeAll(() => {
  document.head.append(appliedUtilities, stylesheet);
});

afterAll(() => {
  appliedUtilities.remove();
  stylesheet.remove();
});

afterEach(() => {
  document.body.innerHTML = "";
});

/**
 * A PPTX `a:srcRect` crop is rendered by oversizing the `<img>` inside an
 * `overflow: hidden` box and scrolling it with a negative offset. These are the
 * real values the converter emits for Superteam slide 1's
 * `<a:srcRect b="26108" l="30408" r="30409" t="62146"/>`.
 */
function renderCroppedImage() {
  document.body.innerHTML = `
    <div class="slide-content">
      <div class="fmd-slide fmd-imported-pptx">
        <div class="fmd-pptx-image" style="overflow: hidden;">
          <img src="wordmark.png" style="display:block;position:absolute;left:-77.6%;top:-529.1%;width:255.21%;height:851.35%;object-fit:fill;" />
        </div>
      </div>
    </div>
  `;
  const image = document.querySelector("img");
  if (!image) throw new Error("test fixture did not render an image");
  return window.getComputedStyle(image);
}

describe("imported slide image crop", () => {
  it("lifts both size caps so a horizontal crop is not clamped back to its box", () => {
    const style = renderCroppedImage();

    // `max-width: 100%` would shrink the image back to its container while the
    // negative `left` kept scrolling, moving the visible crop window off the
    // picture entirely and rendering a blank box.
    expect(style.maxWidth).toBe("none");
    expect(style.maxHeight).toBe("none");
    expect(style.width).toBe("255.21%");
    expect(style.left).toBe("-77.6%");
  });

  it("still strips the decorative defaults meant for markdown slide images", () => {
    const style = renderCroppedImage();

    expect(style.borderRadius).toBe("0px");
    expect(style.margin).toBe("0px");
  });
});
