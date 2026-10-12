import { describe, expect, it } from "vitest";

import { FIRST_PARTY_TEMPLATE_NAMES } from "../server/lib/first-party-metric-catalog";
import { APP_SERIES_COLORS, appSeriesColor } from "./app-series-colors";

describe("APP_SERIES_COLORS", () => {
  it("gives every first-party app its own color", () => {
    const colors = FIRST_PARTY_TEMPLATE_NAMES.map((app) => appSeriesColor(app));
    expect(colors.every((color) => /^#[0-9a-f]{6}$/.test(color ?? ""))).toBe(
      true,
    );
    expect(new Set(Object.values(APP_SERIES_COLORS)).size).toBe(
      Object.keys(APP_SERIES_COLORS).length,
    );
  });

  it("matches app keys however they are cased or padded", () => {
    expect(appSeriesColor(" Mail ")).toBe(APP_SERIES_COLORS.mail);
    expect(appSeriesColor("production")).toBeUndefined();
    expect(appSeriesColor("constructor")).toBeUndefined();
  });
});
