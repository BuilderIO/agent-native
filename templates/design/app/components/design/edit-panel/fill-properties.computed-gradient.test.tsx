// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_SHAPE_FILL } from "../canvas-primitive-style";
import type { ElementInfo } from "../types";
import { FillProperties } from "./fill-properties";
import { mixedElementFromSelection } from "./selection-helpers";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: unknown }) => children as never,
  TooltipTrigger: ({ children }: { children?: unknown }) => children as never,
  TooltipContent: () => null,
  TooltipProvider: ({ children }: { children?: unknown }) => children as never,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children?: unknown }) => children as never,
  PopoverTrigger: ({ children }: { children?: unknown }) => children as never,
  PopoverContent: () => null,
}));

vi.mock("../inspector", () => ({
  DesignColorPicker: ({ trigger }: { trigger?: unknown }) => trigger as never,
  ScrubInput: () => null,
  imageFillToBackgroundStyles: () => ({
    backgroundImage: "",
    backgroundSize: "",
    backgroundRepeat: "",
    backgroundPosition: "",
  }),
}));

vi.mock("./field-primitives", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./field-primitives")>();
  return {
    ...actual,
    FieldTrailer: () => null,
  };
});

vi.mock("./panel-primitives", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./panel-primitives")>();
  return {
    ...actual,
    ColorInput: ({ value }: { value: string }) =>
      createElement("div", {
        "data-testid": "color-input",
        "data-value": value,
      }),
  };
});

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

const SHARED_VECTOR_FILL = "url(#shared-gradient)";
const RED_COMPUTED_GRADIENT =
  "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)";
const BLUE_COMPUTED_GRADIENT =
  "linear-gradient(90deg, #00ff00 0%, #ff00ff 100%)";
const INLINE_GRADIENT = "linear-gradient(90deg, #111111 0%, #eeeeee 100%)";

function vectorShape(
  tagName: "path" | "rect",
  computedGradient: string,
  inlineGradient?: string,
): ElementInfo {
  return element({
    tagName,
    primitiveKind: tagName,
    computedStyles: {
      fill: SHARED_VECTOR_FILL,
      "--an-vector-fill-gradient": computedGradient,
    },
    inlineStyles: inlineGradient
      ? { "--an-vector-fill-gradient": inlineGradient }
      : undefined,
  });
}

describe("FillProperties mixed SVG gradient metadata", () => {
  it("offers replacement when computed gradients differ but computed fills match", async () => {
    const selected = mixedElementFromSelection([
      vectorShape("path", RED_COMPUTED_GRADIENT),
      vectorShape("rect", BLUE_COMPUTED_GRADIENT),
    ]);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onStyleChange = vi.fn();
    const onStylesChange = vi.fn();

    try {
      await act(async () => {
        root.render(
          createElement(FillProperties, {
            element: selected!,
            onStyleChange,
            onStylesChange,
          }),
        );
      });

      expect(host.textContent).toContain("Click + to replace mixed content");
      const addFill = host.querySelector<HTMLButtonElement>(
        'button[aria-label="editPanel.labels.addFill"]',
      );
      expect(addFill).not.toBeNull();
      await act(async () => addFill?.click());

      expect(onStylesChange).toHaveBeenCalledWith(
        { fill: DEFAULT_SHAPE_FILL },
        undefined,
      );
      expect(onStyleChange).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it("does not treat matching computed gradients as mixed", () => {
    const selected = mixedElementFromSelection([
      vectorShape("path", RED_COMPUTED_GRADIENT),
      vectorShape("rect", RED_COMPUTED_GRADIENT),
    ]);
    const markup = renderToStaticMarkup(
      createElement(FillProperties, {
        element: selected!,
        onStyleChange: vi.fn(),
      }),
    );

    expect(selected?.computedStyles["--an-vector-fill-gradient"]).toBe(
      RED_COMPUTED_GRADIENT,
    );
    expect(markup).not.toContain("Click + to replace mixed content");
  });

  it("keeps inline gradient metadata ahead of differing computed metadata", () => {
    const selected = mixedElementFromSelection([
      vectorShape("path", RED_COMPUTED_GRADIENT, INLINE_GRADIENT),
      vectorShape("rect", BLUE_COMPUTED_GRADIENT, INLINE_GRADIENT),
    ]);
    const markup = renderToStaticMarkup(
      createElement(FillProperties, {
        element: selected!,
        onStyleChange: vi.fn(),
      }),
    );

    expect(markup).toContain(`data-value="${INLINE_GRADIENT}"`);
    expect(markup).not.toContain("Click + to replace mixed content");
  });
});
