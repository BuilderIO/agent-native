import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./app/global.css", import.meta.url), "utf8");

function hslTriplet(value: string) {
  const parts = /^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(value.trim());
  if (!parts) throw new Error(`not an hsl triplet: ${value}`);
  const [h, s, l] = [
    Number(parts[1]) / 360,
    Number(parts[2]) / 100,
    Number(parts[3]) / 100,
  ];
  const channel = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [channel(0), channel(8), channel(4)];
}

function luminance(rgb: number[]) {
  const [r = 0, g = 0, b = 0] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function contrast(first: number[], second: number[]) {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The scaffold is what every new app starts from, so its tokens are checked where they are written. */
function token(block: string, name: string) {
  const body = new RegExp(`(?:^|\\n)${block}\\s*\\{([^}]*)\\}`).exec(css);
  if (!body) throw new Error(`no ${block} block`);
  const found = new RegExp(`${name}:\\s*([^;]+);`).exec(body[1]!);
  if (!found) throw new Error(`no ${name} in ${block}`);
  return found[1]!.trim();
}

describe("scaffold palette", () => {
  it("paints error text legibly on the light page", () => {
    expect(
      contrast(hslTriplet(token(":root", "--destructive")), [255, 255, 255]),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("paints error text legibly on the dark page", () => {
    const page = hslTriplet(token(".dark", "--background"));
    expect(
      contrast(hslTriplet(token(".dark", "--destructive")), page),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the destructive foreground legible on its own fill", () => {
    expect(
      contrast(
        hslTriplet(token(":root", "--destructive-foreground")),
        hslTriplet(token(":root", "--destructive")),
      ),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(
        hslTriplet(token(".dark", "--destructive-foreground")),
        hslTriplet(token(".dark", "--destructive")),
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
