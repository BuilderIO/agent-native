// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import type { OverscannedViewportBounds } from "./culling";
import {
  applyScreenPaintSuppression,
  observeScreenPaintTargets,
  resolveSuppressedScreenIds,
  type ScreenPaintCandidate,
  type ScreenPaintTarget,
} from "./paint-suppression";

// oracle-change: removed a MultiScreenCanvas.tsx source grep; the paint suppression cases on the pure helpers remain

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

  it("never suppresses the visible tier", () => {
    expect(
      resolveSuppressedScreenIds(
        [{ id: "screen", geometry: frame(0), tier: "visible" }],
        viewport(50_000, 60_000),
      ).size,
    ).toBe(0);
  });

  // oracle-change: placeholder and evicted shells are now suppressed outside the nearby viewport
  it("suppresses placeholder and evicted screens outside the nearby viewport", () => {
    const candidates: ScreenPaintCandidate[] = [
      { id: "placeholder-near", geometry: frame(0), tier: "placeholder" },
      { id: "placeholder-far", geometry: frame(10_000), tier: "placeholder" },
      { id: "evicted-near", geometry: frame(0), tier: "evicted" },
      { id: "evicted-far", geometry: frame(10_000), tier: "evicted" },
    ];

    expect([
      ...resolveSuppressedScreenIds(
        candidates,
        viewport(50_000, 60_000),
        viewport(-50, 400),
      ),
    ]).toEqual(["placeholder-far", "evicted-far"]);
  });

  it("holds a culled screen to the exact viewport and others to the nearby one", () => {
    const candidates: ScreenPaintCandidate[] = [
      { id: "culled-nearby", geometry: frame(500), tier: "culled" },
      { id: "placeholder-nearby", geometry: frame(500), tier: "placeholder" },
    ];

    expect([
      ...resolveSuppressedScreenIds(
        candidates,
        viewport(-50, 400),
        viewport(-50, 900),
      ),
    ]).toEqual(["culled-nearby"]);
  });

  it("suppresses nothing until the surface has been measured", () => {
    expect(
      resolveSuppressedScreenIds(
        [{ id: "screen", geometry: frame(10_000), tier: "culled" }],
        null,
      ).size,
    ).toBe(0);
  });

  it("refreshes paint targets only when target wrappers change", async () => {
    const surface = document.createElement("div");
    const firstShell = document.createElement("div");
    firstShell.dataset.screenShell = "";
    firstShell.dataset.frameId = "first";
    const first = document.createElement("span");
    first.dataset.screenContent = "";
    firstShell.append(first);
    surface.append(firstShell);

    const updates: ScreenPaintTarget[][] = [];
    const stop = observeScreenPaintTargets(surface, (targets) => {
      updates.push(targets);
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual([{ element: firstShell, screenId: "first" }]);

    first.append(document.createElement("em"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updates).toHaveLength(1);

    const secondShell = document.createElement("div");
    secondShell.dataset.screenShell = "";
    secondShell.dataset.frameId = "second";
    const second = document.createElement("span");
    second.dataset.screenContent = "";
    secondShell.append(second);
    surface.append(secondShell);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updates).toHaveLength(2);
    expect(updates[1]).toEqual([
      { element: firstShell, screenId: "first" },
      { element: secondShell, screenId: "second" },
    ]);

    secondShell.dataset.frameId = "renamed";
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updates[2]).toEqual([
      { element: firstShell, screenId: "first" },
      { element: secondShell, screenId: "renamed" },
    ]);

    firstShell.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updates[3]).toEqual([{ element: secondShell, screenId: "renamed" }]);

    stop();
    secondShell.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updates).toHaveLength(4);
  });

  it("marks a suppressed shell and leaves the inline visibility React owns alone", () => {
    const element = document.createElement("span");
    element.style.setProperty("visibility", "visible");
    const targets = [{ element, screenId: "screen" }];

    applyScreenPaintSuppression(targets, new Set(["screen"]));
    expect(element.dataset.screenPaintSuppressed).toBe("true");
    expect(element.style.visibility).toBe("visible");

    applyScreenPaintSuppression(targets, new Set());
    expect(element.dataset.screenPaintSuppressed).toBeUndefined();
    expect(element.style.visibility).toBe("visible");
  });

  it("keeps a shell painting while its label or selection chrome is still on screen", () => {
    const candidates: ScreenPaintCandidate[] = [
      { id: "label-showing", geometry: frame(0), tier: "culled" },
    ];
    const below = {
      ...candidates[0],
      geometry: { x: 0, y: 1_010, width: 100, height: 100 },
    };

    expect([
      ...resolveSuppressedScreenIds([below], viewport(-50, 400)),
    ]).toEqual(["label-showing"]);
    expect([
      ...resolveSuppressedScreenIds(
        [below],
        viewport(-50, 400),
        viewport(-50, 400),
        33,
      ),
    ]).toEqual([]);
  });

  it("defers hiding a culled screen mid-gesture but still shows it again", () => {
    const element = document.createElement("span");
    const targets = [{ element, screenId: "culled" }];
    const deferHide = (screenId: string) => screenId === "culled";

    applyScreenPaintSuppression(targets, new Set(["culled"]), { deferHide });
    expect(element.dataset.screenPaintSuppressed).toBeUndefined();

    applyScreenPaintSuppression(targets, new Set(["culled"]));
    expect(element.dataset.screenPaintSuppressed).toBe("true");

    applyScreenPaintSuppression(targets, new Set(), { deferHide });
    expect(element.dataset.screenPaintSuppressed).toBeUndefined();
  });

  it("hides a placeholder shell mid-gesture even while culled screens are deferred", () => {
    const placeholder = document.createElement("span");
    const targets = [{ element: placeholder, screenId: "placeholder" }];

    applyScreenPaintSuppression(targets, new Set(["placeholder"]), {
      deferHide: (screenId) => screenId === "culled",
    });
    expect(placeholder.dataset.screenPaintSuppressed).toBe("true");
  });
});
