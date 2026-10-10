import { GRAIN_GRADIENT_EFFECT } from "@shared/native-effect-presets";
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import {
  nativeDisplayedNumber,
  nativeEffectValuesEqual,
  nativeNumericPrecision,
  nativeStoredNumber,
  nativeVisibleProperties,
  NativeEffectControls,
  NativeNumericScrub,
} from "./NativeEffectControls";

describe("native numeric property precision", () => {
  it("keeps Grain's thousandth-step default exact in its editable field", () => {
    expect(nativeNumericPrecision(0.001)).toBe(3);
    expect((0.065).toFixed(nativeNumericPrecision(0.001))).toBe("0.065");
  });

  it("keeps whole and hundredth-step values readable", () => {
    expect(nativeNumericPrecision(1)).toBe(0);
    expect(nativeNumericPrecision(0.01)).toBe(2);
  });
});

describe("native display units", () => {
  it("shows percentages without changing the normalized stored value", () => {
    expect(nativeDisplayedNumber(0.35, 100)).toBe(35);
    expect(nativeStoredNumber(35, 100)).toBe(0.35);
    expect(nativeNumericPrecision(0.001 * 100)).toBe(1);
  });

  it("round-trips degree display without accumulating floating-point noise", () => {
    const scale = 180 / Math.PI;
    expect(
      nativeStoredNumber(nativeDisplayedNumber(Math.PI / 2, scale), scale),
    ).toBeCloseTo(Math.PI / 2, 10);
  });
});

describe("native precise numeric gesture", () => {
  it("does not commit the rounded display on focus and blur", () => {
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() =>
      root.render(
        <NativeNumericScrub
          label="Grain"
          value={0.123456789}
          step={0.001}
          precision={3}
          onChange={onChange}
        />,
      ),
    );
    const input = host.querySelector("input")!;
    act(() => {
      input.focus();
      input.blur();
    });
    expect(onChange).not.toHaveBeenCalled();
    act(() => root.unmount());
    host.remove();
  });
});

describe("native property visibility", () => {
  const definition = {
    ...GRAIN_GRADIENT_EFFECT,
    properties: {
      mode: {
        type: "enum" as const,
        label: "Mode",
        default: "basic",
        options: ["basic", "extra"],
      },
      detail: {
        type: "float" as const,
        label: "Detail",
        default: 0.5,
        advanced: true,
        group: "Texture",
        visibleWhen: { property: "mode", equals: "extra" },
      },
    },
  };

  it("keeps conditional advanced controls hidden until both conditions hold", () => {
    expect(
      nativeVisibleProperties(definition, {}, true).map(([name]) => name),
    ).toEqual(["mode"]);
    expect(
      nativeVisibleProperties(definition, { mode: "basic" }, true).map(
        ([name]) => name,
      ),
    ).toEqual(["mode"]);
    expect(
      nativeVisibleProperties(definition, { mode: "extra" }, false).map(
        ([name]) => name,
      ),
    ).toEqual(["mode"]);
    expect(
      nativeVisibleProperties(definition, { mode: "extra" }, true).map(
        ([name]) => name,
      ),
    ).toEqual(["mode", "detail"]);
  });

  it("compares parsed color and vector defaults by value for reset", () => {
    expect(
      nativeEffectValuesEqual(
        { space: "display-p3", components: [0.12, 0.34, 0.56], alpha: 0.8 },
        { alpha: 0.8, components: [0.12, 0.34, 0.56], space: "display-p3" },
      ),
    ).toBe(true);
    expect(nativeEffectValuesEqual([0.12, 0.34], [0.12, 0.35])).toBe(false);
  });
});

it("marks a differing selected property without claiming the first value is shared", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <NativeEffectControls
        definition={GRAIN_GRADIENT_EFFECT}
        values={{ scale: 1.2 }}
        mixedNames={new Set(["scale"])}
        disabled={false}
        onValueChange={vi.fn()}
      />,
    ),
  );
  expect(host.querySelectorAll('[role="status"]')).toHaveLength(1);
  expect(host.querySelector('[role="status"]')?.textContent).toContain(
    "editPanel.shaders.nativeMixedValues",
  );
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("reorders whole palette colors in one commit while preserving alpha and gamut", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const colors = [
    {
      space: "display-p3" as const,
      components: [1, 0, 0] as [number, number, number],
      alpha: 0.3,
    },
    {
      space: "srgb" as const,
      components: [0, 1, 0] as [number, number, number],
      alpha: 0.8,
    },
    {
      space: "srgb" as const,
      components: [0, 0, 1] as [number, number, number],
      alpha: 1,
    },
  ];
  const definition = {
    ...GRAIN_GRADIENT_EFFECT,
    id: "test-palette",
    properties: {
      palette: {
        type: "color-array" as const,
        label: "Palette",
        default: colors,
        maxCount: 8,
      },
    },
  };
  const onValueChange = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    act(() =>
      root.render(
        <NativeEffectControls
          definition={definition}
          values={{ palette: colors }}
          disabled={false}
          onValueChange={onValueChange}
        />,
      ),
    );
    const up = host.querySelectorAll<HTMLButtonElement>(
      '[aria-label="editPanel.shaders.nativeMoveColorUp"]',
    );
    const down = host.querySelectorAll<HTMLButtonElement>(
      '[aria-label="editPanel.shaders.nativeMoveColorDown"]',
    );
    expect(up[0]!.disabled).toBe(true);
    expect(down[2]!.disabled).toBe(true);
    act(() => down[0]!.click());
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith(
      "palette",
      [colors[1], colors[0], colors[2]],
      "commit",
    );
    expect(colors[0]!.space).toBe("display-p3");
    expect(colors[0]!.alpha).toBe(0.3);
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
