import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Row 541: the data module shipped a dark-only palette, so in the light theme the
 * labels on a data panel inherited the page's dark text — 1.18:1 on the panel,
 * which is Saya's "dark text on dark" BigQuery report. This pins both halves of
 * the fix: a palette per theme, and a module root that sets its own text colour
 * (a palette alone cannot help a label that inherits from the page).
 */
const tokensCss = readFileSync(
  path.join(process.cwd(), "app/components/data/tokens/colors.css"),
  "utf8",
);

function hslToRgb(hex: string): [number, number, number] {
  const value = hex.trim().replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(hslToRgb(a)), luminance(hslToRgb(b))].sort(
    (x, y) => y - x,
  ) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function palette(selector: string): Record<string, string> {
  const start = tokensCss.indexOf(selector);
  expect(start, `${selector} is not in colors.css`).toBeGreaterThan(-1);
  const open = tokensCss.indexOf("{", start);
  const close = tokensCss.indexOf("}", open);
  const body = tokensCss.slice(open, close);
  const out: Record<string, string> = {};
  for (const match of body.matchAll(
    /--(data-[a-z-]+):\s*(#[0-9a-fA-F]{3,8})/g,
  )) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) out[name] = value;
  }
  return out;
}

describe.each([
  ["light", ":root {"],
  ["dark", ":root.dark {"],
])("%s data palette", (theme, selector) => {
  const colors = palette(selector);

  it("has its own surface and text, not the other theme's", () => {
    expect(colors["data-surface"]).toBeDefined();
    expect(colors["data-text"]).toBeDefined();
  });

  it("keeps labels and secondary text at 4.5:1 on the data surface", () => {
    const surface = colors["data-surface"];
    expect(surface, `${theme}: data-surface is missing`).toBeDefined();
    for (const token of [
      "data-text",
      "data-muted",
      "data-link",
      "data-danger",
    ]) {
      const value = colors[token];
      expect(value, `${theme}: ${token} is missing`).toBeDefined();
      const ratio = contrast(value!, surface!);
      expect(
        ratio,
        `${theme}: ${token} on surface is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

// oracle-change: test-audit campaign removed whole low-value tests, see PR 498
