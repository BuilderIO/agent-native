import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Legibility for the labels these two stylesheets own, checked as numbers rather
 * than by eye (Steve 11/9: a tester bug is a class, not a one-off). The verifier
 * measured the Home prompt actions at 2.03:1 in light and the search match at
 * 3.75:1 light / 4.27:1 dark on served 686b694c09, so each declaration here is
 * asserted against the background it actually paints over: body text needs
 * 4.5:1.
 */
function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => {
    const raw = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return raw <= 0.03928 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = channels as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

function declaration(file: string, selector: string, property: string): string {
  const css = readFileSync(join(__dirname, file), "utf8");
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} exists in ${file}`).toBeGreaterThanOrEqual(0);
  const block = css.slice(start, css.indexOf("}", start));
  const match = new RegExp(`(?:^|\\s)${property}:\\s*([^;]+);`).exec(block);
  expect(match, `${selector} declares ${property}`).not.toBeNull();
  return (match as RegExpExecArray)[1]!.trim();
}

describe("added UI labels meet the body-text contrast floor", () => {
  it("the Home prompt action labels clear 4.5:1 in both themes", () => {
    expect(
      contrast(
        declaration("home.css", ".ws-home-prompt-action", "color"),
        "#ffffff",
      ),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(
        declaration("home.css", ".dark .ws-home-prompt-action", "color"),
        "#1f1f29",
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("the search match highlight clears 4.5:1 on its own background in both themes", () => {
    // Light mark background measured as rgb(231, 228, 240); dark as rgb(79, 74, 81).
    expect(
      contrast(
        declaration("../search/search.css", ".ws-search-mark", "color"),
        "#e7e8f0",
      ),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(
        declaration("../search/search.css", ".dark .ws-search-mark", "color"),
        "#4f4a51",
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
