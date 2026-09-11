// @vitest-environment happy-dom

/**
 * Regression coverage for a cluster of fill/gradient color-picker bugs
 * reported for an *existing* background layer's own row popover (as
 * opposed to the base fill row, which already rendered a single
 * `DesignColorPicker` directly):
 *
 *   1. Clicking an existing gradient/image layer's row required a second
 *      click to reach the real color picker.
 *   2. Clicking inside the open picker's gradient editor (a stop handle)
 *      closed the picker instead of letting the user interact with it.
 *   3. Switching an existing layer's paint type closed the picker and
 *      dropped the pending change.
 *
 * Root cause: the row wrapped `DesignColorPicker` — which already owns its
 * own `Popover` — in a *second*, independent outer `Popover` for a
 * custom-looking trigger (swatch + "Linear 1" + opacity, instead of
 * DesignColorPicker's default swatch + hex). Two nested popovers meant the
 * outer one opened first (showing DesignColorPicker's own default trigger,
 * requiring a second click), and the outer popover's dismissable layer
 * treated pointer interaction with the inner picker's portaled content as
 * "outside", closing both the instant the gradient editor was touched. The
 * row was also keyed by the layer's own CSS content
 * (`` `${layer}-${index}` ``), so any edit to that layer — including a
 * paint-type switch — remounted the row and reset its open popover.
 *
 * This file renders the real `FillProperties` component with real
 * `Popover`/`DesignColorPicker`/`GradientEditor` (nothing mocked except
 * i18n, tooltips, and the unrelated motion `FieldTrailer`), so it exercises
 * the actual popover lifecycle rather than a stubbed one.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: unknown }) => children as never,
  TooltipTrigger: ({ children }: { children?: unknown }) => children as never,
  TooltipContent: () => null,
  TooltipProvider: ({ children }: { children?: unknown }) => children as never,
}));

vi.mock("./field-primitives", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./field-primitives")>();
  return {
    ...actual,
    FieldTrailer: () => null,
  };
});

import type { ElementInfo } from "../types";
import { FillProperties } from "./fill-properties";

function element(overrides: Partial<ElementInfo> = {}): ElementInfo {
  return {
    tagName: "div",
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 0, height: 0 },
    isFlexChild: false,
    isFlexContainer: false,
    childElementCount: 0,
    ...overrides,
  } as ElementInfo;
}

const GRADIENT_LAYER = "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)";

function gradientLayerElement(backgroundImage = GRADIENT_LAYER): ElementInfo {
  return element({
    computedStyles: {
      // Fully transparent base color — hides the base fill row so only the
      // layer row under test renders (matches the reported scenario: an
      // element whose only fill is a background-image gradient layer).
      backgroundColor: "rgba(0, 0, 0, 0)",
      backgroundImage,
      backgroundSize: "",
      backgroundRepeat: "",
      backgroundPosition: "",
    },
  });
}

function findButtonByText(
  root: HTMLElement,
  text: string,
): HTMLButtonElement | null {
  return (
    Array.from(root.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes(text),
    ) ?? null
  );
}

function gradientStopsBar(): HTMLElement | null {
  return document.querySelector('[role="group"][aria-label="Gradient stops"]');
}

const RADIAL_LAYER =
  "radial-gradient(circle at center, #00ff00 0%, #ff00ff 100%)";

function twoLayerElement(): ElementInfo {
  return element({
    computedStyles: {
      backgroundColor: "rgba(0, 0, 0, 0)",
      backgroundImage: [GRADIENT_LAYER, RADIAL_LAYER].join(", "),
      backgroundSize: "",
      backgroundRepeat: "",
      backgroundPosition: "",
    },
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  // Radix portals content onto document.body directly — clean up anything
  // left behind between tests (defensive; unmount should already do this).
  document
    .querySelectorAll("[data-radix-popper-content-wrapper]")
    .forEach((node) => node.remove());
});

describe("FillProperties — existing layer fill popover", () => {
  it("opens the real gradient editor on the first click (no duplicate/phantom popover)", () => {
    act(() => {
      root.render(
        <FillProperties
          element={gradientLayerElement()}
          onStyleChange={vi.fn()}
          onStylesChange={vi.fn()}
        />,
      );
    });

    const trigger = findButtonByText(container, "Linear gradient 1");
    expect(trigger).not.toBeNull();

    act(() => {
      trigger!.click();
    });

    // Before the fix, this first click only opened an *outer* popover
    // containing DesignColorPicker's own (still-closed) default trigger —
    // the real gradient editor needed a second click to appear.
    expect(gradientStopsBar()).not.toBeNull();
  });

  it("keeps the picker open when clicking a gradient stop handle inside it", () => {
    act(() => {
      root.render(
        <FillProperties
          element={gradientLayerElement()}
          onStyleChange={vi.fn()}
          onStylesChange={vi.fn()}
        />,
      );
    });

    act(() => {
      findButtonByText(container, "Linear gradient 1")!.click();
    });
    expect(gradientStopsBar()).not.toBeNull();

    const stopHandle = document.querySelector<HTMLButtonElement>(
      "button[aria-pressed]",
    );
    expect(stopHandle).not.toBeNull();

    act(() => {
      stopHandle!.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
        }),
      );
      stopHandle!.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
        }),
      );
    });

    // Before the fix, the outer popover's dismissable layer treated this
    // click on the inner picker's portaled content as "outside" and closed
    // both popovers.
    expect(gradientStopsBar()).not.toBeNull();
  });

  it("keeps the picker open and applies the change when switching gradient kind", () => {
    const onStyleChange = vi.fn();

    act(() => {
      root.render(
        <FillProperties
          element={gradientLayerElement()}
          onStyleChange={onStyleChange}
          onStylesChange={vi.fn()}
        />,
      );
    });

    act(() => {
      findButtonByText(container, "Linear gradient 1")!.click();
    });
    expect(gradientStopsBar()).not.toBeNull();

    const radialTab = document.querySelector<HTMLButtonElement>(
      '[aria-label="Radial"]',
    );
    expect(radialTab).not.toBeNull();

    act(() => {
      radialTab!.click();
    });

    expect(onStyleChange).toHaveBeenCalledWith(
      "backgroundImage",
      expect.stringContaining("radial-gradient"),
    );
    // The row previously remounted (content-derived key) or closed (nested
    // popover dismissal) the instant this commit landed.
    expect(gradientStopsBar()).not.toBeNull();
  });

  it("does not remount (and lose its open state) when the layer's CSS content changes", () => {
    act(() => {
      root.render(
        <FillProperties
          element={gradientLayerElement()}
          onStyleChange={vi.fn()}
          onStylesChange={vi.fn()}
        />,
      );
    });

    act(() => {
      findButtonByText(container, "Linear gradient 1")!.click();
    });
    expect(gradientStopsBar()).not.toBeNull();

    // Simulate the parent committing an edit to this same layer (e.g. a
    // stop color/position change, or a paint-type switch) — the row was
    // previously keyed by the layer's own CSS string, so this remounted the
    // popover (an uncontrolled `Popover` remount always starts closed) and
    // silently closed it.
    act(() => {
      root.render(
        <FillProperties
          element={gradientLayerElement(
            "linear-gradient(90deg, #00ff00 0%, #ff00ff 100%)",
          )}
          onStyleChange={vi.fn()}
          onStylesChange={vi.fn()}
        />,
      );
    });

    expect(gradientStopsBar()).not.toBeNull();
  });

  it("does not show the Solid or None tabs on an existing layer's picker", () => {
    act(() => {
      root.render(
        <FillProperties
          element={gradientLayerElement()}
          onStyleChange={vi.fn()}
          onStylesChange={vi.fn()}
        />,
      );
    });

    act(() => {
      findButtonByText(container, "Linear gradient 1")!.click();
    });
    expect(gradientStopsBar()).not.toBeNull();

    // Both routed through DesignColorPicker's solid-only `emitColor`/
    // `onChange` path, which this row wires to a gradient-stop-color patch
    // — clicking either silently discarded the click instead of doing
    // anything coherent (reported as "switching to solid closes the popup
    // and the change isn't reflected").
    expect(document.querySelector('[aria-label="Solid"]')).toBeNull();
    expect(document.querySelector('[aria-label="None"]')).toBeNull();
    // Sanity check: other structurally-supported tabs are still present.
    expect(document.querySelector('[aria-label="Radial"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Image"]')).not.toBeNull();
  });

  it("does not leave a removed layer picker attached to the layer at its old position", () => {
    act(() => {
      root.render(
        <FillProperties
          element={twoLayerElement()}
          onStyleChange={vi.fn()}
          onStylesChange={vi.fn()}
        />,
      );
    });

    act(() => {
      findButtonByText(container, "Linear gradient 1")!.click();
    });
    expect(gradientStopsBar()).not.toBeNull();

    const removeButtons = document.querySelectorAll(
      '[aria-label="editPanel.labels.removeLayer"]',
    );
    expect(removeButtons.length).toBe(2);
    act(() => {
      (removeButtons[0] as HTMLButtonElement).click();
    });

    act(() => {
      root.render(
        <FillProperties
          element={gradientLayerElement(RADIAL_LAYER)}
          onStyleChange={vi.fn()}
          onStylesChange={vi.fn()}
        />,
      );
    });

    const survivorTrigger = findButtonByText(container, "Radial gradient 1");
    expect(survivorTrigger).not.toBeNull();
    expect(gradientStopsBar()).toBeNull();

    act(() => {
      (survivorTrigger as HTMLButtonElement).click();
    });
    expect(gradientStopsBar()).not.toBeNull();
  });
});
