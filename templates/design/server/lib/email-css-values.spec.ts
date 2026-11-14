import { describe, expect, it } from "vitest";

import { inspectEmailCssValue } from "./email-css-values.js";

describe("email CSS value inspection", () => {
  it.each([
    "#faf9f5",
    "rgba(10, 20, 30, 0.5)",
    "linear-gradient(#fff, rgb(10 20 30 / 50%))",
    "radial-gradient(circle, red, blue)",
    '"url(https://example.test/pixel.png)"',
    '"image-set(pixel.png 1x)"',
  ])("preserves static CSS value %s", (value) => {
    expect(inspectEmailCssValue(value)).toBe("supported");
  });

  it.each([
    "url(https://example.test/pixel.png)",
    'url("https://example.test/pixel.png")',
    'image-set("https://example.test/pixel.png" 1x)',
    '-WEBKIT-IMAGE-SET("https://example.test/pixel.png" 1x)',
    'cross-fade(red, image-set("https://example.test/pixel.png" 1x))',
    'image("https://example.test/pixel.png")',
    "expression(alert(1))",
    "linear-gradient(red, var(--brand))",
    'var(--image, image-set("https://example.test/pixel.png" 1x))',
  ])("identifies browser or asset value %s", (value) => {
    expect(inspectEmailCssValue(value)).toBe("browser");
  });

  it.each([
    "",
    ")",
    "rgb(]",
    "red; display:none",
    "url/**/(https://example.test/pixel.png)",
  ])("reports invalid CSS value %s distinctly", (value) => {
    expect(inspectEmailCssValue(value)).toBe("invalid");
  });
});
