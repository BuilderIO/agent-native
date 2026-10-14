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

vi.mock("@agent-native/core/client/uploads", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/uploads")
  >()),
  useFileUploadStatus: () => ({ isSuccess: false }),
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

/** The paint rows of the existing layers, in layer order. */
function layerRows(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      '[data-inspector-layout="drag-paint-row"]',
    ),
  );
}

/** The trigger of the layer at `index`, if its Fill field reads `text`. */
function layerFieldTrigger(
  root: HTMLElement,
  index: number,
  text: string,
): HTMLButtonElement | null {
  const trigger = layerRows(root)[index]?.querySelector<HTMLButtonElement>(
    'button[aria-haspopup="dialog"]',
  );
  return trigger?.textContent?.includes(text) ? trigger : null;
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

  it("opens the picker for a newly added background layer", () => {
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

    expect(document.querySelector('button[aria-label="Solid"]')).toBeNull();

    const addFillButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="editPanel.labels.addFill"]',
    );
    expect(addFillButton).not.toBeNull();
    act(() => addFillButton!.click());

    expect(onStylesChange).toHaveBeenCalledWith(
      expect.objectContaining({ backgroundImage: expect.any(String) }),
      undefined,
    );
    expect(
      document.querySelector('button[aria-label="Solid"][aria-pressed="true"]'),
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
        .querySelector<HTMLButtonElement>('[aria-label="Gradient"]')!
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
        .querySelector<HTMLButtonElement>('[aria-label="Gradient"]')!
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
    expect(layerFieldTrigger(container, 1, "Radial")).not.toBeNull();
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

    act(() => layerFieldTrigger(container, 0, "Linear")!.click());
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
    expect(layerFieldTrigger(container, 0, "FF0000")).not.toBeNull();
    expect(layerFieldTrigger(container, 1, "Radial")).not.toBeNull();
  });

  it("keeps an existing gradient layer when switching it to Image before an image is chosen", () => {
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

    act(() => layerFieldTrigger(container, 0, "Linear")!.click());
    for (const unsupported of ["Video", "Noise", "Pattern", "Shader"]) {
      expect(
        document.querySelector(`[aria-label="${unsupported}"]`),
      ).toBeNull();
    }
    act(() => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="Image"]')!
        .click();
    });
    const urlInput = document.querySelector<HTMLInputElement>(
      'input[aria-label="Image URL"]',
    );
    expect(urlInput).not.toBeNull();
    act(() => {
      urlInput!.focus();
      urlInput!.blur();
    });

    expect(onStyleChange).not.toHaveBeenCalled();
    expect(onStylesChange).not.toHaveBeenCalled();
    expect(layerFieldTrigger(container, 0, "Linear")).not.toBeNull();
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

    act(() => layerFieldTrigger(container, 0, "Linear")!.click());
    act(() => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="Solid"]')!
        .click();
    });

    const solidTrigger = layerFieldTrigger(container, 0, "CC3366");
    expect(solidTrigger?.textContent).toContain("20%");
    expect(onStyleChange).toHaveBeenLastCalledWith(
      "backgroundImage",
      "linear-gradient(rgba(204, 51, 102, 0.2) 0 0)",
      undefined,
    );

    act(() => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="Gradient"]')!
        .click();
    });

    expect(gradientStopsBar()).not.toBeNull();
    expect(onStyleChange).toHaveBeenLastCalledWith(
      "backgroundImage",
      originalGradient,
      undefined,
    );
  });

  it("edits one stop's opacity in its own row without averaging away an asymmetric sibling", () => {
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

    act(() => layerFieldTrigger(container, 0, "Linear")!.click());
    const [firstStop, secondStop] = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input[aria-label="editPanel.colorPicker.stopOpacity"]',
      ),
    );
    expect(firstStop?.value).toBe("100");
    expect(secondStop?.value).toBe("0");

    const typeAndCommit = (input: HTMLInputElement, text: string) => {
      act(() => {
        input.focus();
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      act(() => {
        input.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    };
    const lastStopOpacities = () => {
      const call =
        onStyleChange.mock.calls[onStyleChange.mock.calls.length - 1];
      return parseGradientLayer(call?.[1] as string)?.stops.map(
        (stop) => stop.opacity,
      );
    };

    typeAndCommit(firstStop!, "20");
    expect(lastStopOpacities()).toEqual([20, 0]);

    typeAndCommit(firstStop!, "100");
    expect(lastStopOpacities()).toEqual([100, 0]);
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

    expect(layerFieldTrigger(container, 0, "Linear")).not.toBeNull();
    expect(layerFieldTrigger(container, 0, "FF0000")).toBeNull();
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

    act(() => layerFieldTrigger(container, 0, "Linear")!.click());
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
    expect(layerFieldTrigger(container, 0, "Radial")).not.toBeNull();
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
        .querySelector<HTMLButtonElement>('[aria-label="Gradient"]')!
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
    expect(layerFieldTrigger(container, 0, "Linear")).not.toBeNull();
    expect(layerFieldTrigger(container, 1, "Linear")).not.toBeNull();
    expect(
      container.querySelectorAll('[aria-label="editPanel.labels.removeLayer"]'),
    ).toHaveLength(2);

    const convertedGradientRow = layerRows(container)[1];
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
    expect(layerFieldTrigger(container, 0, "Linear")).not.toBeNull();
    expect(layerFieldTrigger(container, 1, "Linear")).toBeNull();
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

    const trigger = layerFieldTrigger(container, 0, "Linear");
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
      layerFieldTrigger(container, 0, "Linear")!.click();
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

  it("keeps the picker open and applies the change when switching gradient kind", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Element.prototype.scrollIntoView = () => {};
    Element.prototype.hasPointerCapture = () => false;
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
      layerFieldTrigger(container, 0, "Linear")!.click();
    });
    expect(gradientStopsBar()).not.toBeNull();

    // One Type select holds the four gradient kinds; there are no per-kind icons.
    expect(document.querySelector('[aria-label="Radial"]')).toBeNull();
    const typeSelect = document.querySelector<HTMLElement>(
      '[aria-label="Type"]',
    );
    expect(typeSelect).not.toBeNull();

    await act(async () => {
      typeSelect!.focus();
      typeSelect!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    const kinds = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    );
    expect(kinds.map((option) => option.textContent)).toEqual([
      "Linear",
      "Radial",
      "Angular",
      "Diamond",
    ]);
    await act(async () => {
      const radial = kinds.find((option) => option.textContent === "Radial")!;
      radial.focus();
      radial.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
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
      layerFieldTrigger(container, 0, "Linear")!.click();
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
      layerFieldTrigger(container, 0, "Linear")!.click();
    });
    expect(gradientStopsBar()).not.toBeNull();

    expect(document.querySelector('[aria-label="Solid"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="None"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Gradient"]')).not.toBeNull();
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
      layerFieldTrigger(container, 0, "Linear")!.click();
    });
    expect(gradientStopsBar()).not.toBeNull();

    const removeButtons = document.querySelectorAll(
      '[aria-label="editPanel.labels.removeLayer"]',
    );
    expect(removeButtons.length).toBe(2);
    const activeGradientRow = layerRows(container)[0];
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

    const survivorTrigger = layerFieldTrigger(container, 0, "Radial");
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
        .querySelector<HTMLButtonElement>('button[aria-label="Gradient"]')!
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

    const layerTrigger = layerFieldTrigger(container, 0, "Linear");
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
        .querySelector<HTMLButtonElement>('button[aria-label="Gradient"]')!
        .click();
    });

    expect(styles.backgroundImage).toContain("linear-gradient(");
    expect(styles.backgroundColor).toBe("transparent");

    renderBox();
    expect(gradientStopsBar()).not.toBeNull();
    expect(layerFieldTrigger(container, 0, "Linear")).not.toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    renderBox();

    const layerTrigger = layerFieldTrigger(container, 0, "Linear");
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
