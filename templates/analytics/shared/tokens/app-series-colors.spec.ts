import { describe, expect, it } from "vitest";

import { FIRST_PARTY_TEMPLATE_NAMES } from "../../server/lib/first-party-metric-catalog";
import {
  APP_SERIES_COLORS,
  NON_APP_SERIES_COLORS,
  UNKNOWN_APP_COLOR,
  appSeriesColor,
  isUnknownApp,
} from "./app-series-colors";

function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((at) => {
      const c = parseInt(hex.slice(at, at + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function oklab(hex: string): number[] {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const [l, m, s] = [
    0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b,
    0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b,
    0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b,
  ].map(Math.cbrt);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

describe("APP_SERIES_COLORS", () => {
  const all = [
    ...Object.values(APP_SERIES_COLORS),
    UNKNOWN_APP_COLOR,
    ...NON_APP_SERIES_COLORS,
  ];

  it("gives every first-party app its own color, apart from the grays", () => {
    for (const app of FIRST_PARTY_TEMPLATE_NAMES) {
      expect(appSeriesColor(app)).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(new Set(all).size).toBe(all.length);
  });

  it("keeps 3:1 contrast on the light and the dark card", () => {
    for (const color of all) {
      expect(contrast(color, "#ffffff")).toBeGreaterThanOrEqual(3);
      expect(contrast(color, "#262626")).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps every pair of colors visibly apart", () => {
    for (const [index, a] of all.entries()) {
      for (const b of all.slice(index + 1)) {
        const [la, aa, ba] = oklab(a);
        const [lb, ab, bb] = oklab(b);
        expect(Math.hypot(la - lb, aa - ab, ba - bb) * 100).toBeGreaterThan(8);
      }
    }
  });

  it("matches app keys however they are cased or padded", () => {
    expect(appSeriesColor(" Mail ")).toBe(APP_SERIES_COLORS.mail);
    expect(appSeriesColor("unknown")).toBeUndefined();
    expect(isUnknownApp(" Unknown")).toBe(true);
    expect(appSeriesColor("constructor")).toBeUndefined();
  });
});
