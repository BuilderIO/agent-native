import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const css = readFileSync(
  new URL("../../../global.css", import.meta.url),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

function themeVariables(selector: string) {
  const start = css.indexOf(`\n${selector} {`);
  const body = css.slice(start, css.indexOf("\n}", start));
  return new Map(
    Array.from(
      body.matchAll(/(--[\w-]+):\s*([^;]+);/g),
      ([, name = "", value = ""]) => [name, value.trim()] as const,
    ),
  );
}

const syntaxColors = Array.from(
  css.matchAll(/([^{}]+)\{([^{}]*)\}/g),
  ([, selectors = "", body = ""]) => {
    const [, color = ""] = /(?:^|;)\s*color:\s*([^;]+);/.exec(body) ?? [];
    return { selectors: selectors.trim(), color: color.trim() };
  },
).filter(
  ({ selectors, color }) =>
    color !== "" &&
    selectors
      .split(",")
      .every((selector) =>
        selector.trim().startsWith(".content-editor .hljs-"),
      ),
);

function resolve(color: string, variables: Map<string, string>) {
  const [, name = ""] = /^hsl\(var\((--[\w-]+)\)\)$/.exec(color) ?? [];
  const [, literal = ""] = /^hsl\(([^)]+)\)$/.exec(color) ?? [];
  return variables.get(name) ?? literal;
}

function luminance(hsl: string) {
  const [h = 0, s = 0, l = 0] = (hsl.match(/[\d.]+/g) ?? []).map(Number);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const value = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}

function contrast(foreground: string, background: string) {
  const [high = 0, low = 0] = [
    luminance(foreground),
    luminance(background),
  ].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

describe("code colors", () => {
  it("finds the stylesheet's syntax colors", () => {
    expect(syntaxColors.length).toBeGreaterThan(10);
  });

  for (const theme of [":root", ".dark"]) {
    it(`keeps every syntax color readable on the code block in ${theme}`, () => {
      const variables = themeVariables(theme);
      const background = variables.get("--muted") ?? "";
      expect(background).toMatch(/^[\d.]+ [\d.]+% [\d.]+%$/);
      const unreadable = syntaxColors
        .map(({ selectors, color }) => ({
          selectors,
          color: resolve(color, variables),
        }))
        .filter(
          ({ color }) =>
            !/^[\d.]+ [\d.]+% [\d.]+%$/.test(color) ||
            contrast(color, background) < 4.5,
        );
      expect(unreadable).toEqual([]);
    });
  }
});
