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
import { useState } from "react";
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
import { parseGradientLayer, splitCssLayers } from "./fill-gradient-helpers";
import { FillProperties } from "./fill-properties";
import type {
  StyleChangeHandler,
  StylesChangeHandler,
} from "./style-change-types";

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
      backgroundColor: "rgba(0, 0, 0, 0)",
      backgroundImage,
      backgroundSize: "",
      backgroundRepeat: "",
      backgroundPosition: "",
    },
  });
}

function StatefulSolidFill({
  onStyleChange,
  onStylesChange,
  initialStyles = {},
}: {
  onStyleChange: StyleChangeHandler;
  onStylesChange: StylesChangeHandler;
  initialStyles?: Record<string, string>;
}) {
  const [computedStyles, setComputedStyles] = useState({
    backgroundColor: "rgb(255, 0, 0)",
    backgroundImage: "none",
    backgroundSize: "",
    backgroundRepeat: "",
    backgroundPosition: "",
    ...initialStyles,
  });
  return (
    <FillProperties
      element={element({ computedStyles })}
      onStyleChange={(property, value, meta) => {
        onStyleChange(property, value, meta);
        setComputedStyles((current) => ({ ...current, [property]: value }));
      }}
      onStylesChange={(patch, meta) => {
        onStylesChange(patch, meta);
        setComputedStyles((current) => ({ ...current, ...patch }));
      }}
    />
  );
}

function findButtonByText(
  root: HTMLElement,
  text: string,
): HTMLButtonElement | null {
  return (
    Array.from(root.querySelectorAll("button")).find(
      (btn) =>
        btn.textContent?.includes(text) ||
        btn.getAttribute("aria-label")?.includes(text),
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
  document
    .querySelectorAll("[data-radix-popper-content-wrapper]")
    .forEach((node) => node.remove());
});

describe("FillProperties — existing layer fill popover", () => {
  it("distinguishes zero-opacity, hidden, and removed base paints", () => {
    const onStyleChange = vi.fn();
    const renderPaint = (authored: string) =>
      act(() =>
        root.render(
          <FillProperties
            element={element({
              computedStyles: { backgroundColor: "rgba(0, 0, 0, 0)" },
              inlineStyles: { backgroundColor: authored },
            })}
            onStyleChange={onStyleChange}
          />,
        ),
      );
    renderPaint("rgba(0, 0, 0, 0)");
    expect(
      container.querySelector('[aria-label="editPanel.labels.hideLayer"]'),
    ).not.toBeNull();
    renderPaint("color-mix(in srgb, rgba(0, 0, 0, 0.5) 0%, transparent)");
    const show = container.querySelector<HTMLButtonElement>(
      '[aria-label="editPanel.labels.showLayer"]',
    );
    expect(show).not.toBeNull();
    act(() => show!.click());
    expect(onStyleChange).toHaveBeenCalledWith(
      "backgroundColor",
      "rgba(0, 0, 0, 0.5)",
    );
    renderPaint("transparent");
    expect(
      container.querySelector('[aria-label="editPanel.labels.hideLayer"]'),
    ).toBeNull();
  });

  it("can hide Add fill without hiding other fill-section actions", () => {
    act(() => {
      root.render(
        <FillProperties
          element={element({ computedStyles: { color: "#ff0000" } })}
          onStyleChange={vi.fn()}
          hideAddFill
        />,
      );
    });

    expect(
      container.querySelector('button[aria-label="editPanel.labels.addFill"]'),
    ).toBeNull();
    expect(
      container.querySelector(
        'button[aria-label="editPanel.labels.stylesComingSoon"]',
      ),
    ).not.toBeNull();
  });

  it("keeps the picker open and commits solid-to-gradient as one patch", () => {
    const onStyleChange = vi.fn();
    const onStylesChange = vi.fn();
    act(() => {
      root.render(
        <StatefulSolidFill
          onStyleChange={onStyleChange}
          onStylesChange={onStylesChange}
        />,
      );
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Open color picker"]',
        )!
        .click();
    });
    expect(gradientStopsBar()).toBeNull();

    act(() => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="Linear"]')!
        .click();
    });

    expect(gradientStopsBar()).not.toBeNull();
    expect(onStyleChange).not.toHaveBeenCalled();
    expect(onStylesChange).toHaveBeenCalledTimes(1);
    expect(onStylesChange).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        backgroundColor: "transparent",
        backgroundImage: expect.stringContaining("linear-gradient"),
      }),
      undefined,
    );
  });

  it("converts the base solid below image and gradient siblings", () => {
    const onStyleChange = vi.fn();
    const onStylesChange = vi.fn();
    const imageLayer = "url(https://example.test/image.png)";
    const siblingGradient = RADIAL_LAYER;
    act(() => {
      root.render(
        <StatefulSolidFill
          onStyleChange={onStyleChange}
          onStylesChange={onStylesChange}
          initialStyles={{
            backgroundColor: "#ff0000",
            backgroundImage: [imageLayer, siblingGradient].join(", "),
            backgroundSize: "cover, 24px 24px",
            backgroundRepeat: "no-repeat, repeat-x",
            backgroundPosition: "center, 30% 40%",
          }}
        />,
      );
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Open color picker"]',
        )!
        .click();
    });
    act(() => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="Linear"]')!
        .click();
    });

    expect(onStyleChange).not.toHaveBeenCalled();
    expect(onStylesChange).toHaveBeenCalledTimes(1);
    const patch = onStylesChange.mock.calls[0][0] as Record<string, string>;
    const images = splitCssLayers(patch.backgroundImage);
    expect(patch).toEqual({
      backgroundColor: "transparent",
      backgroundImage: expect.any(String),
      backgroundSize: "cover, 24px 24px, auto",
      backgroundRepeat: "no-repeat, repeat-x, no-repeat",
      backgroundPosition: "center, 30% 40%, 0% 0%",
    });
    expect(images).toHaveLength(3);
    expect(images[0]).toBe(imageLayer);
    expect(images[1]).toBe(siblingGradient);
    expect(parseGradientLayer(images[2])?.stops[0].color).toBe("#ff0000");
    expect(gradientStopsBar()).not.toBeNull();
    expect(findButtonByText(container, "Radial gradient 2")).not.toBeNull();
  });

  it("converts a top gradient to a solid layer without changing its paint order", () => {
    const onStyleChange = vi.fn();
    const onStylesChange = vi.fn();
    act(() => {
      root.render(
        <StatefulSolidFill
          onStyleChange={onStyleChange}
          onStylesChange={onStylesChange}
          initialStyles={{
            backgroundColor: "#123456",
            backgroundImage: [GRADIENT_LAYER, RADIAL_LAYER].join(", "),
            backgroundSize: "24px 24px, cover",
            backgroundRepeat: "no-repeat, repeat-x",
            backgroundPosition: "10% 20%, 30% 40%",
          }}
        />,
      );
    });

    act(() => findButtonByText(container, "Linear gradient 1")!.click());
    expect(gradientStopsBar()).not.toBeNull();
    act(() => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="Solid"]')!
        .click();
    });

    expect(gradientStopsBar()).toBeNull();
    expect(document.querySelector('input[aria-label="Hex"]')).not.toBeNull();
    expect(onStylesChange).not.toHaveBeenCalled();
    expect(onStyleChange).toHaveBeenCalledTimes(1);
    expect(onStyleChange).toHaveBeenCalledWith(
      "backgroundImage",
      ["linear-gradient(#ff0000 0 0)", RADIAL_LAYER].join(", "),
      undefined,
    );
    expect(findButtonByText(container, "#ff0000")).not.toBeNull();
    expect(findButtonByText(container, "Radial gradient 2")).not.toBeNull();
  });

  it("preserves a gradient's first-stop opacity and stops when switching back in the open picker", () => {
    const onStyleChange = vi.fn();
    const onStylesChange = vi.fn();
    const originalGradient =
      "linear-gradient(90deg, rgba(204, 51, 102, 0.2) 0%, rgba(51, 102, 204, 0.2) 100%)";
    act(() => {
      root.render(
        <StatefulSolidFill
          onStyleChange={onStyleChange}
          onStylesChange={onStylesChange}
          initialStyles={{
            backgroundColor: "#123456",
            backgroundImage: originalGradient,
          }}
        />,
      );
    });

    act(() => findButtonByText(container, "Linear gradient 1")!.click());
    act(() => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="Solid"]')!
        .click();
    });

    const solidTrigger = findButtonByText(container, "#cc3366");
    expect(solidTrigger?.textContent).toContain("20%");
    expect(onStyleChange).toHaveBeenLastCalledWith(
      "backgroundImage",
      "linear-gradient(rgba(204, 51, 102, 0.2) 0 0)",
      undefined,
    );

    act(() => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="Linear"]')!
        .click();
    });

    expect(gradientStopsBar()).not.toBeNull();
    expect(onStyleChange).toHaveBeenLastCalledWith(
      "backgroundImage",
      originalGradient,
      undefined,
    );
  });

  it("edits the selected stop alpha without averaging away an asymmetric sibling", () => {
    const onStyleChange = vi.fn();
    const onStylesChange = vi.fn();
    act(() => {
      root.render(
        <StatefulSolidFill
          onStyleChange={onStyleChange}
          onStylesChange={onStylesChange}
          initialStyles={{
            backgroundColor: "rgba(0, 0, 0, 0)",
            backgroundImage:
              "linear-gradient(90deg, #cc3366 0%, rgba(51, 102, 204, 0) 100%)",
          }}
        />,
      );
    });

    act(() => findButtonByText(container, "Linear gradient 1")!.click());
    const opacity = document.querySelector<HTMLElement>(
      '[role="slider"][aria-label="Opacity"]',
    )!;
    expect(opacity.getAttribute("aria-valuenow")).toBe("100");
    act(() => {
      opacity.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
      );
    });
    act(() => {
      opacity.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowUp",
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    act(() => {
      opacity.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowUp",
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    const lastTwentyCall =
      onStyleChange.mock.calls[onStyleChange.mock.calls.length - 1];
    const atTwenty = parseGradientLayer(lastTwentyCall?.[1] as string);
    expect(atTwenty?.stops.map((stop) => stop.opacity)).toEqual([20, 0]);

    act(() => {
      opacity.dispatchEvent(
        new KeyboardEvent("keydown", { key: "End", bubbles: true }),
      );
    });
    const lastRestoredCall =
      onStyleChange.mock.calls[onStyleChange.mock.calls.length - 1];
    const restored = parseGradientLayer(lastRestoredCall?.[1] as string);
    expect(restored?.stops.map((stop) => stop.opacity)).toEqual([100, 0]);
  });

  it("keeps ordinary uniform two-stop gradients classified as gradients", () => {
    act(() => {
      root.render(
        <StatefulSolidFill
          onStyleChange={vi.fn()}
          onStylesChange={vi.fn()}
          initialStyles={{
            backgroundColor: "rgba(0, 0, 0, 0)",
            backgroundImage: "linear-gradient(90deg, #ff0000 0%, #ff0000 100%)",
          }}
        />,
      );
    });

    expect(findButtonByText(container, "Linear gradient 1")).not.toBeNull();
    expect(findButtonByText(container, "Solid 1")).toBeNull();
  });

  it("removes only the chosen fill for None and closes its picker", () => {
    const onStyleChange = vi.fn();
    const onStylesChange = vi.fn();
    act(() => {
      root.render(
        <StatefulSolidFill
          onStyleChange={onStyleChange}
          onStylesChange={onStylesChange}
          initialStyles={{
            backgroundColor: "rgba(0, 0, 0, 0)",
            backgroundImage: [GRADIENT_LAYER, RADIAL_LAYER].join(", "),
            backgroundSize: "24px 24px, cover",
            backgroundRepeat: "no-repeat, repeat-x",
            backgroundPosition: "10% 20%, 30% 40%",
          }}
        />,
      );
    });

    act(() => findButtonByText(container, "Linear gradient 1")!.click());
    expect(gradientStopsBar()).not.toBeNull();
    act(() => {
      document.querySelector<HTMLButtonElement>('[aria-label="None"]')!.click();
    });

    expect(gradientStopsBar()).toBeNull();
    expect(onStyleChange).not.toHaveBeenCalled();
    expect(onStylesChange).toHaveBeenCalledTimes(1);
    expect(onStylesChange).toHaveBeenCalledWith(
      {
        backgroundImage: RADIAL_LAYER,
        backgroundSize: "cover",
        backgroundRepeat: "repeat-x",
        backgroundPosition: "30% 40%",
      },
      undefined,
    );
    expect(findButtonByText(container, "Radial gradient 1")).not.toBeNull();
  });

  it("closes the converted layer picker when that layer is removed", () => {
    const onStyleChange = vi.fn();
    const onStylesChange = vi.fn();
    act(() => {
      root.render(
        <StatefulSolidFill
          onStyleChange={onStyleChange}
          onStylesChange={onStylesChange}
          initialStyles={{ backgroundImage: GRADIENT_LAYER }}
        />,
      );
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Open color picker"]',
        )!
        .click();
    });
    act(() => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="Linear"]')!
        .click();
    });
    expect(gradientStopsBar()).not.toBeNull();
    const conversionPatch =
      onStylesChange.mock.calls[onStylesChange.mock.calls.length - 1]?.[0];
    expect(conversionPatch?.backgroundColor).toBe("transparent");
    const convertedLayers = splitCssLayers(
      conversionPatch?.backgroundImage ?? "",
    );
    expect(convertedLayers).toHaveLength(2);
    expect(convertedLayers[0]).toBe(GRADIENT_LAYER);
    expect(findButtonByText(container, "Linear gradient 1")).not.toBeNull();
    expect(findButtonByText(container, "Linear gradient 2")).not.toBeNull();
    expect(
      container.querySelectorAll('[aria-label="editPanel.labels.removeLayer"]'),
    ).toHaveLength(2);

    const convertedGradientRow = Array.from(
      container.querySelectorAll<HTMLElement>(
        '[data-inspector-action-rail="fixed"]',
      ),
    ).find((row) => findButtonByText(row, "Linear gradient 2") !== null);
    if (!convertedGradientRow) {
      throw new Error("Converted gradient row did not render");
    }
    const removeConvertedGradient =
      convertedGradientRow.querySelector<HTMLButtonElement>(
        '[aria-label="editPanel.labels.removeLayer"]',
      );
    if (!removeConvertedGradient) {
      throw new Error("Converted gradient row has no remove action");
    }
    act(() => {
      removeConvertedGradient.click();
    });

    expect(gradientStopsBar()).toBeNull();
    expect(findButtonByText(container, "Linear gradient 1")).not.toBeNull();
    expect(findButtonByText(container, "Linear gradient 2")).toBeNull();
    expect(
      onStylesChange.mock.calls[onStylesChange.mock.calls.length - 1]?.[0]
        .backgroundImage,
    ).toBe(GRADIENT_LAYER);
  });

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
      undefined,
    );
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

  it("shows solid and none tabs on an existing layer's picker", () => {
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

    expect(document.querySelector('[aria-label="Solid"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="None"]')).not.toBeNull();
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
    const activeGradientRow = Array.from(
      container.querySelectorAll<HTMLElement>(
        '[data-inspector-action-rail="fixed"]',
      ),
    ).find((row) => findButtonByText(row, "Linear gradient 1") !== null);
    if (!activeGradientRow) {
      throw new Error("Active gradient row did not render");
    }
    const removeActiveGradient =
      activeGradientRow.querySelector<HTMLButtonElement>(
        '[aria-label="editPanel.labels.removeLayer"]',
      );
    if (!removeActiveGradient) {
      throw new Error("Active gradient row has no remove action");
    }
    act(() => {
      removeActiveGradient.click();
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

  it("applies, preserves, and removes a text gradient across reselection", () => {
    let styles: Record<string, string> = {
      color: "#ff0000",
      backgroundImage: "none",
      backgroundClip: "border-box",
    };
    const onStyleChange = (property: string, value: string) => {
      styles = { ...styles, [property]: value };
    };
    const onStylesChange = (patch: Record<string, string>) => {
      styles = { ...styles, ...patch };
    };
    const renderText = () =>
      act(() =>
        root.render(
          <FillProperties
            element={element({ tagName: "span", computedStyles: styles })}
            onStyleChange={onStyleChange}
            onStylesChange={onStylesChange}
          />,
        ),
      );

    renderText();
    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Open color picker"]',
        )!
        .click();
    });
    act(() => {
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Linear"]')!
        .click();
    });

    expect(styles.backgroundImage).toContain("linear-gradient(");
    expect(styles.backgroundClip).toBe("text");
    expect(styles.color).toBe("transparent");

    renderText();
    expect(gradientStopsBar()).not.toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    renderText();

    const layerTrigger = findButtonByText(container, "Linear gradient 1");
    expect(layerTrigger).not.toBeNull();
    act(() => layerTrigger!.click());
    expect(gradientStopsBar()).not.toBeNull();

    const removeButtons = container.querySelectorAll<HTMLButtonElement>(
      '[aria-label="editPanel.labels.removeLayer"]',
    );
    expect(removeButtons).toHaveLength(2);
    act(() => removeButtons[1]!.click());

    expect(styles.backgroundImage).toBe("none");
    expect(styles.backgroundClip).toBe("border-box");
    expect(styles.color).toBe("#ff0000");
  });

  it("keeps the box gradient editor mounted through conversion and reselection", () => {
    let styles: Record<string, string> = {
      backgroundColor: "#ff0000",
      backgroundImage: "none",
    };
    const onStyleChange = (property: string, value: string) => {
      styles = { ...styles, [property]: value };
    };
    const onStylesChange = (patch: Record<string, string>) => {
      styles = { ...styles, ...patch };
    };
    const renderBox = () =>
      act(() =>
        root.render(
          <FillProperties
            element={element({ tagName: "div", computedStyles: styles })}
            onStyleChange={onStyleChange}
            onStylesChange={onStylesChange}
          />,
        ),
      );

    renderBox();
    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Open color picker"]',
        )!
        .click();
    });
    act(() => {
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Linear"]')!
        .click();
    });

    expect(styles.backgroundImage).toContain("linear-gradient(");
    expect(styles.backgroundColor).toBe("transparent");

    renderBox();
    expect(gradientStopsBar()).not.toBeNull();
    expect(findButtonByText(container, "Linear gradient 1")).not.toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    renderBox();

    const layerTrigger = findButtonByText(container, "Linear gradient 1");
    expect(layerTrigger).not.toBeNull();
    act(() => layerTrigger!.click());
    expect(gradientStopsBar()).not.toBeNull();
  });

  it("keeps the mixed-text replacement instruction and action aligned", () => {
    const onStylesChange = vi.fn();

    act(() => {
      root.render(
        <FillProperties
          element={element({
            tagName: "span",
            computedStyles: {
              color: "Mixed",
              backgroundImage: "Mixed",
              backgroundClip: "Mixed",
            },
          })}
          onStyleChange={vi.fn()}
          onStylesChange={onStylesChange}
        />,
      );
    });

    expect(container.textContent).toContain("Click + to replace mixed content");
    const replaceButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="editPanel.labels.addFill"]',
    );
    expect(replaceButton).not.toBeNull();

    act(() => replaceButton!.click());

    expect(onStylesChange.mock.calls[0]?.[0]).toEqual({
      color: "#000000",
      backgroundImage: "none",
      backgroundClip: "border-box",
    });
    expect(onStylesChange).toHaveBeenCalledOnce();
  });
});
