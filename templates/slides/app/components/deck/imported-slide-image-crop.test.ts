// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

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
