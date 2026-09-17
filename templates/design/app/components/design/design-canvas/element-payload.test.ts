import { describe, expect, it } from "vitest";

import {
  isComputedStyleMap,
  parseRuntimeSnapshotHtml,
} from "./element-payload";

describe("computed style bridge payloads", () => {
  it("accepts complete complex gradients and rejects malformed values", () => {
    const backgroundImage = `linear-gradient(90deg, ${Array.from({ length: 40 }, (_, index) => `rgba(120, 80, 200, 0.5) ${index}%`).join(", ")})`;
    expect(backgroundImage.length).toBeGreaterThan(512);
    expect(
      isComputedStyleMap({
        backgroundImage,
        opacity: "0.5",
        webkitBackdropFilter: undefined,
      }),
    ).toBe(true);
    expect(isComputedStyleMap({ backgroundImage, opacity: 0.5 })).toBe(false);
    expect(isComputedStyleMap(null)).toBe(false);
    expect(isComputedStyleMap([backgroundImage])).toBe(false);
  });
});

describe("runtime snapshot payload bounds", () => {
  it("accepts the exact cap and reports oversize or unavailable evidence explicitly", () => {
    const html = "x".repeat(2_000_000);
    expect(parseRuntimeSnapshotHtml(html)).toEqual({ ok: true, html });
    expect(parseRuntimeSnapshotHtml(html + "x")).toEqual({
      ok: false,
      reason: "snapshot-too-large",
    });
    for (const unavailable of [undefined, null, "", {}, 1]) {
      expect(parseRuntimeSnapshotHtml(unavailable)).toEqual({
        ok: false,
        reason: "snapshot-unavailable",
      });
    }
  });
});
