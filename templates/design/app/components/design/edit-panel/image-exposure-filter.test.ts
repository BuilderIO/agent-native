import { describe, expect, it } from "vitest";

import {
  exposureFilterUrl,
  exposureFromFilter,
  withoutExposureFilter,
} from "./image-exposure-filter";

describe("exposureFilterUrl", () => {
  it("is a self-contained data URL whose fragment records the slider value", () => {
    const url = exposureFilterUrl(-35);
    expect(url).toMatch(
      /^url\("data:image\/svg\+xml,[^"]+#an-exposure--35"\)$/,
    );
    expect(exposureFromFilter(`blur(2px) ${url}`)).toBe(-35);
    expect(
      withoutExposureFilter(`blur(2px) ${url} contrast(1.1)`)
        .replace(/\s+/g, " ")
        .trim(),
    ).toBe("blur(2px) contrast(1.1)");
  });

  it("interpolates between the fitted steps", () => {
    const table = (value: number) =>
      decodeURIComponent(exposureFilterUrl(value)).match(
        /tableValues="([^"]+)"/,
      )![1]!;
    const [low, mid, high] = [25, 37, 50].map((v) =>
      Number(table(v).split(" ")[8]),
    );
    expect(mid).toBeGreaterThan(low!);
    expect(mid).toBeLessThan(high!);
  });
});
