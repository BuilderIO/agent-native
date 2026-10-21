// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import {
  applyScaleContent,
  captureScaleContent,
  createLatestFrame,
  minScaleContentFactor,
  restoreScaleContent,
} from "./slide-scale-content";

function build() {
  const root = document.createElement("div");
  root.setAttribute("style", "font-size: 20px; padding: 10px; width: 200px");
  const child = document.createElement("p");
  child.setAttribute("style", "font-size: 10px; margin-top: 4px");
  root.appendChild(child);
  document.body.appendChild(root);
  return { root, child };
}

describe("slide scale content", () => {
  it("multiplies font sizes, padding and descendant margins", () => {
    const { root, child } = build();
    const snapshots = captureScaleContent([root]);
    applyScaleContent(snapshots, 2);
    expect(root.style.fontSize).toBe("40px");
    expect(root.style.paddingTop).toBe("20px");
    expect(child.style.fontSize).toBe("20px");
    expect(child.style.marginTop).toBe("8px");
    // The root's box is the geometry gesture's, not this module's.
    expect(root.style.width).toBe("200px");
  });

  it("restores the original inline styles", () => {
    const { root, child } = build();
    const snapshots = captureScaleContent([root]);
    applyScaleContent(snapshots, 3);
    restoreScaleContent(snapshots);
    expect(root.getAttribute("style")).toBe(
      "font-size: 20px; padding: 10px; width: 200px",
    );
    expect(child.getAttribute("style")).toBe(
      "font-size: 10px; margin-top: 4px",
    );
  });

  it("holds the smallest font at the floor", () => {
    const { root } = build();
    const snapshots = captureScaleContent([root]);
    expect(minScaleContentFactor(snapshots)).toBeCloseTo(0.6);
  });

  it("never forces growth when a font is already under the floor", () => {
    const root = document.createElement("div");
    root.setAttribute("style", "font-size: 4px");
    document.body.appendChild(root);
    expect(minScaleContentFactor(captureScaleContent([root]))).toBe(1);
  });
});

describe("createLatestFrame", () => {
  it("applies only the newest value once per frame", () => {
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const applied: number[] = [];
    const frame = createLatestFrame((value: number) => applied.push(value));
    frame.push(1);
    frame.push(2);
    frame.push(3);
    expect(frames).toHaveLength(1);
    frames[0]!();
    expect(applied).toEqual([3]);
    vi.unstubAllGlobals();
  });

  it("flush applies the pending value and cancel drops it", () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const applied: number[] = [];
    const frame = createLatestFrame((value: number) => applied.push(value));
    frame.push(1);
    frame.flush();
    frame.push(2);
    frame.cancel();
    frame.flush();
    expect(applied).toEqual([1]);
    vi.unstubAllGlobals();
  });
});
