// @vitest-environment happy-dom

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { OverscannedViewportBounds } from "./culling";
import {
  applyScreenPaintSuppression,
  resolveSuppressedScreenIds,
  type ScreenPaintCandidate,
} from "./paint-suppression";

const frame = (x: number): ScreenPaintCandidate["geometry"] => ({
  x,
  y: 0,
  width: 100,
  height: 100,
});

const viewport = (left: number, right: number): OverscannedViewportBounds => ({
  left,
  top: -1_000,
  right,
  bottom: 1_000,
});

describe("overview paint suppression", () => {
  it("keeps a culled screen painting once the live camera brings it on screen", () => {
    const candidates: ScreenPaintCandidate[] = [
      { id: "on-screen", geometry: frame(0), tier: "culled" },
      { id: "far-away", geometry: frame(10_000), tier: "culled" },
    ];

    expect([
      ...resolveSuppressedScreenIds(candidates, viewport(-50, 400)),
    ]).toEqual(["far-away"]);
  });

  it("never suppresses a tier that owns no hideable content", () => {
    const outside = viewport(50_000, 60_000);
    for (const tier of ["visible", "placeholder", "evicted"] as const) {
      expect(
        resolveSuppressedScreenIds(
          [{ id: "screen", geometry: frame(0), tier }],
          outside,
        ).size,
      ).toBe(0);
    }
  });

  it("suppresses nothing until the surface has been measured", () => {
    expect(
      resolveSuppressedScreenIds(
        [{ id: "screen", geometry: frame(10_000), tier: "culled" }],
        null,
      ).size,
    ).toBe(0);
  });

  it("writes a freshly mounted wrapper and leaves an unchanged one alone", () => {
    const element = document.createElement("span");
    const targets = [{ element, screenId: "screen" }];

    applyScreenPaintSuppression(targets, new Set(["screen"]));
    expect(element.style.visibility).toBe("hidden");
    expect(element.style.getPropertyValue("content-visibility")).toBe("");

    element.style.setProperty("visibility", "visible");
    applyScreenPaintSuppression(targets, new Set(["screen"]));
    expect(element.style.visibility).toBe("visible");

    applyScreenPaintSuppression(targets, new Set());
    expect(element.style.visibility).toBe("");
    expect(element.style.getPropertyValue("content-visibility")).toBe("");
  });

  it("leaves paint suppression to one owner outside React's render path", () => {
    const source = readFileSync(
      "app/components/design/MultiScreenCanvas.tsx",
      "utf8",
    );
    expect(source).not.toContain("contentVisibility:");
    expect(source).not.toContain("visibility: isCulled");
    const applyViewToDom = source.slice(
      source.indexOf("const applyViewToDom = useCallback("),
    );
    expect(applyViewToDom.slice(0, applyViewToDom.indexOf("}, ["))).toContain(
      "syncScreenPaintSuppression();",
    );
  });
});
