import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Steve 11/9: served acceptance checks legibility in light AND dark through the
 * app's own theme switch — body text 4.5:1, large text 3:1. This pins the token
 * pairs every screen reads, so a token edit that quietly drops below the line
 * fails here instead of in a reviewer's screenshot.
 */
const css = readFileSync(path.join(process.cwd(), "app/global.css"), "utf8");

function themeBlock(selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `${selector} not found in global.css`).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  const end = css.indexOf("}", start);
  return css.slice(
    start,
    Math.min(end === -1 ? css.length : end, start + 4000),
  );
}

const token = (block: string, name: string): string => {
  const match = block.match(
    new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`),
  );
  if (!match) throw new Error(`token --${name} is not an hsl triplet`);
  return `${match[1]} ${match[2]}% ${match[3]}%`;
};

function hslToRgb(value: string): [number, number, number] {
  const [h, s, l] = value.replace(/%/g, "").split(" ").map(Number);
  if (h === undefined || s === undefined || l === undefined) {
    throw new Error(`not an hsl triplet: ${value}`);
  }
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: [number, number, number] = [0, 0, 0];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = light - c / 2;
  return [(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928
      ? scaled / 12.92
      : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(hslToRgb(a)), luminance(hslToRgb(b))].sort(
    (x, y) => y - x,
  ) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = [
  "background",
  "card",
  "muted",
  "secondary",
  "popover",
] as const;

describe.each([
  ["light", ":root,\n:root.light"],
  ["dark", ":root.dark"],
])("%s theme legibility", (theme, selector) => {
  const block = themeBlock(selector);

  it("keeps body text at 4.5:1 on every surface", () => {
    for (const surface of SURFACES) {
      const ratio = contrast(token(block, "foreground"), token(block, surface));
      expect(
        ratio,
        `foreground on ${surface} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps muted text at 4.5:1 on every surface", () => {
    for (const surface of SURFACES) {
      const ratio = contrast(
        token(block, "muted-foreground"),
        token(block, surface),
      );
      expect(
        ratio,
        `muted-foreground on ${surface} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps primary text at 4.5:1 on the page and cards", () => {
    for (const surface of ["background", "card"] as const) {
      const ratio = contrast(token(block, "primary"), token(block, surface));
      expect(
        ratio,
        `primary on ${surface} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe.each(["light", "dark"] as const)(
  "reference skin %s palette legibility",
  (mode) => {
    const skin = readFileSync(
      path.join(process.cwd(), "app/skins/reference/theme.ts"),
      "utf8",
    );
    const block = skin.slice(
      skin.indexOf(`${mode}: {`),
      mode === "light" ? skin.indexOf("dark: {") : undefined,
    );
    const hex = (name: string): [number, number, number] => {
      const match = block.match(new RegExp(`"?${name}"?:\\s*"#([0-9a-f]{6})"`));
      if (!match) throw new Error(`skin token ${name} is not a hex colour`);
      const value = match[1]!;
      return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as [
        number,
        number,
        number,
      ];
    };
    const ratio = (fg: string, bg: string) => {
      const [hi, lo] = [luminance(hex(fg)), luminance(hex(bg))].sort(
        (x, y) => y - x,
      ) as [number, number];
      return (hi + 0.05) / (lo + 0.05);
    };

    it.each(["muted-foreground", "sidebar-foreground"])(
      "keeps %s at 4.5:1 on every surface",
      (name) => {
        for (const surface of [...SURFACES, "accent"]) {
          expect(
            ratio(name, surface),
            `${name} on ${surface} is ${ratio(name, surface).toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(4.5);
        }
        expect(ratio(name, "sidebar-accent")).toBeGreaterThanOrEqual(4.5);
      },
    );
  },
);
