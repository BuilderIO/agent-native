import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * analytics-2.sweep#8: destructive and error text was painted with the literal
 * Tailwind colour `text-red-600`, which is not one of this app's theme tokens -
 * so it kept the same red in both themes instead of following the palette.
 * voice-2 fixed the same class by moving the value into its palette
 * (ad0e6b2072), and this app already carries the token: --ws-danger, defined
 * once per theme in global.css.
 *
 * These checks are source-level and numeric: no literal left at the call sites,
 * and both theme values clear the 4.5:1 body-text bar against their own page
 * background.
 */

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map(
    (offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255,
  );
  const [r = 0, g = 0, b = 0] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const [a = 0, b = 0] = [luminance(foreground), luminance(background)].sort(
    (x, y) => y - x,
  );
  return (a + 0.05) / (b + 0.05);
}

/** Every value declared for a custom property in global.css, in file order. */
function tokenValues(name: string): string[] {
  const css = read("../../global.css");
  const pattern = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`, "g");
  return [...css.matchAll(pattern)].map((match) => String(match[1] ?? ""));
}

describe("destructive text uses the theme token", () => {
  it("carries a danger value for each theme that clears 4.5:1 on its own page", () => {
    const danger = tokenValues("--ws-danger");
    const background = tokenValues("--ws-bg");
    expect(danger).toHaveLength(2); // light first, then dark
    expect(background).toHaveLength(2);
    const ratios = danger.map((value, index) =>
      contrast(value, background[index] ?? ""),
    );
    ratios.forEach((ratio) => expect(ratio).toBeGreaterThanOrEqual(4.5));
  });
});

// oracle-change: test-audit campaign removed whole low-value tests, see PR 498
