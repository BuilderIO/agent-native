// @vitest-environment happy-dom

import type { EffectPaint } from "@shared/native-effects";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NestedColorRequest } from "./color-picker-nested";
import {
  nativeEffectPaintFromCss,
  nativeEffectPaintToCss,
  NativeShaderPaintValueError,
} from "./native-shader-paint";
import { NativeShaderPaintControls } from "./NativeShaderPaintControls";

const GRAY: EffectPaint = {
  kind: "solid",
  color: { space: "srgb", components: [0.5, 0.5, 0.5], alpha: 1 },
};
const GRADIENT =
  "linear-gradient(37deg in srgb, #ff0000 0%, #00ff00 35%, #0000ff 100%)";

describe("native shader paint adapter", () => {
  it("keeps unchanged normalized solid colors exact", () => {
    expect(
      nativeEffectPaintFromCss(nativeEffectPaintToCss(GRAY), GRAY),
    ).toEqual(GRAY);
  });

  it("round trips gradient kind, direction, positions, colors, interpolation and fill opacity", () => {
    const paint = nativeEffectPaintFromCss(GRADIENT);
    expect(paint).toEqual({
      kind: "linear",
      angle: 37,
      interpolation: "in srgb",
      stops: [
        {
          position: 0,
          color: { space: "srgb", components: [1, 0, 0], alpha: 1 },
        },
        {
          position: 0.35,
          color: { space: "srgb", components: [0, 1, 0], alpha: 1 },
        },
        {
          position: 1,
          color: { space: "srgb", components: [0, 0, 1], alpha: 1 },
        },
      ],
    });
    const faded = { ...paint, opacity: 0.4 } as EffectPaint;
    expect(
      nativeEffectPaintFromCss(nativeEffectPaintToCss(faded), faded),
    ).toEqual(faded);
    for (const kind of ["radial", "angular", "diamond"] as const) {
      const next = {
        ...paint,
        kind,
        angle: kind === "angular" ? 37 : 90,
      } as EffectPaint;
      expect(
        nativeEffectPaintFromCss(nativeEffectPaintToCss(next), next),
      ).toEqual(next);
    }
  });

  it("accepts the shared picker's signed decimal angles", () => {
    expect(
      nativeEffectPaintFromCss(
        "conic-gradient(from -37.25deg at center in srgb, #ff0000 0%, #0000ff 100%)",
      ),
    ).toMatchObject({ kind: "angular", angle: -37.25 });
  });

  it("retains P3 colors and makes implicit modern-color interpolation explicit", () => {
    const paint = nativeEffectPaintFromCss(
      "linear-gradient(90deg, color(display-p3 1 0.3 0.1) 0%, #000000 100%)",
    );
    expect(paint.kind).toBe("linear");
    if (paint.kind === "solid") throw new Error("Expected a gradient");
    expect(paint.interpolation).toBe("in oklab");
    expect(paint.stops[0]!.color).toEqual({
      space: "display-p3",
      components: [1, 0.3, 0.1],
      alpha: 1,
    });
    expect(
      nativeEffectPaintFromCss(nativeEffectPaintToCss(paint), paint),
    ).toEqual(paint);
    expect(
      nativeEffectPaintFromCss(
        "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)",
      ),
    ).toMatchObject({ interpolation: "in srgb" });
  });

  it("rejects invalid paints, unsupported interpolation and excess stops", () => {
    for (const css of [
      "not-a-color",
      "radial-gradient(circle at 20% 30%, #ff0000 0%, #0000ff 100%)",
      "radial-gradient(circle 30px at center, #ff0000 0%, #0000ff 100%)",
      "linear-gradient(to right, #ff0000 0%, #0000ff 100%)",
      "linear-gradient(90deg, #ff0000)",
      "linear-gradient(90deg in hsl longer hue, #ff0000 0%, #0000ff 100%)",
      `linear-gradient(90deg, ${Array.from({ length: 9 }, (_, i) => `#ff0000 ${i * 12.5}%`).join(", ")})`,
    ]) {
      expect(() => nativeEffectPaintFromCss(css)).toThrow(
        NativeShaderPaintValueError,
      );
    }
  });
});

describe("native shader paint field", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let request: NestedColorRequest | undefined;
  const onPreview = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    request = undefined;
    onPreview.mockReset();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  const renderField = async (
    onCommit: (paint: EffectPaint) => Promise<boolean>,
  ) => {
    await act(async () =>
      root.render(
        <NativeShaderPaintControls
          label="Fill"
          value={GRAY}
          maxStops={8}
          disabled={false}
          onCommit={onCommit}
          onPreview={onPreview}
          renderColorPicker={(next) => {
            request = next;
            return null;
          }}
        />,
      ),
    );
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('button[aria-label="Fill"]')!
        .click(),
    );
  };

  it("opens the shared paint request from one compact solid gray row", async () => {
    await renderField(vi.fn(async () => true));
    expect(host.textContent).toContain("808080");
    expect(host.textContent).toContain("100%");
    expect(request!.supportedPaintTypes).toEqual([
      "solid",
      "linear",
      "radial",
      "angular",
      "diamond",
    ]);
    expect(request!.maxGradientStops).toBe(8);
    expect(request!.showReverseStops).toBe(false);
    expect(request!.css).toBe("#808080");
    expect(host.querySelector("select")).toBeNull();
  });

  it("previews on the canvas, commits one structured paint, and rolls back a rejected save", async () => {
    let resolveSave: (saved: boolean) => void = () => {
      throw new Error("Save not started");
    };
    const onCommit = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSave = resolve;
        }),
    );
    await renderField(onCommit);
    await act(async () => request!.onChange(GRADIENT));
    expect(onCommit).not.toHaveBeenCalled();
    expect(onPreview).toHaveBeenLastCalledWith(
      nativeEffectPaintFromCss(GRADIENT),
    );
    expect(request!.css).toBe(GRADIENT);
    await act(async () => request!.onCommit(GRADIENT));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(
      nativeEffectPaintFromCss(GRADIENT),
    );
    await act(async () => resolveSave(false));
    expect(request!.css).toBe("#808080");
    expect(host.textContent).toContain("808080");
    expect(onPreview).toHaveBeenLastCalledWith(GRAY);
  });
});
