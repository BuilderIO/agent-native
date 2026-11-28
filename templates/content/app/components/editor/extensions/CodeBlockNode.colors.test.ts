import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const css = readFileSync(
  new URL("../../../global.css", import.meta.url),
  "utf8",
);

function themeVariables(selector: string) {
  const start = css.indexOf(`\n${selector} {`);
  const body = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [
      name,
      value.trim(),
    ]),
  );
}

function luminance(hsl: string) {
  const [h, s, l] = hsl.match(/[\d.]+/g)!.map(Number);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const value = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}

function contrast(foreground: string, background: string) {
  const [high, low] = [luminance(foreground), luminance(background)].sort(
    (x, y) => y - x,
  );
  return (high + 0.05) / (low + 0.05);
}

describe("code colors", () => {
  for (const theme of [":root", ".dark"]) {
    it(`keeps every syntax color readable on the code block in ${theme}`, () => {
      const variables = themeVariables(theme);
      const tokens = Object.entries(variables).filter(([name]) =>
        name.startsWith("--code-token-"),
      );
      expect(tokens.length).toBeGreaterThan(0);
      for (const [name, value] of tokens) {
        expect(contrast(value, variables["--muted"]), name).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    });
  }
});
