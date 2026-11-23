// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

type Rgb = [number, number, number];

const read = (name: string) =>
  readFileSync(new URL(name, import.meta.url), "utf8");

function block(css: string, selector: string) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing rule ${selector}`);
  return css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
}

function declaration(rule: string, property: string) {
  const match = new RegExp(`(?:^|[\\s;])${property}:\\s*([^;]+);`).exec(rule);
  if (!match?.[1]) throw new Error(`Missing ${property}`);
  return match[1].trim();
}

function hexToRgb(hex: string): Rgb {
  const full =
    hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex;
  return [1, 3, 5].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(
      255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))),
    );
  };
  return [f(0), f(8), f(4)];
}

function luminance(rgb: Rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

function resolveColor(value: string, theme: string): Rgb {
  if (value.startsWith("#")) return hexToRgb(value);
  const variable = /^(?:hsl\()?var\((--[a-z0-9-]+)(?:,[^)]*)?\)\)?$/.exec(
    value,
  )?.[1];
  if (!variable) throw new Error(`Unresolvable colour ${value}`);
  const raw = new RegExp(`${variable}:\\s*([^;]+);`).exec(theme)?.[1]?.trim();
  if (!raw) throw new Error(`${variable} is not declared in the theme`);
  if (raw.startsWith("#")) return hexToRgb(raw);
  const [h, s, l] = (raw.match(/[\d.]+/g) ?? []).map(Number) as Rgb;
  return hslToRgb(h, s, l);
}

describe("workspace label create button", () => {
  const rule = block(read("settings.css"), ".ws-label-create-submit");
  const global = read("../../global.css");

  for (const theme of ["light", "dark"]) {
    it(`keeps its label legible on the brand fill in the ${theme} theme`, () => {
      const tokens = block(global, `:root.${theme}`);
      const background = resolveColor(declaration(rule, "background"), tokens);
      const foreground = resolveColor(declaration(rule, "color"), tokens);
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
