// @vitest-environment happy-dom

/**
 * Base fill row image-layer prop wiring regression.
 *
 * `FillProperties`' base swatch renders a `<ColorInput>` whose
 * `onImageFillLayerChange` builds its commit patch from whatever ColorInput
 * computes internally from its `backgroundImage`/`backgroundSize`/
 * `backgroundRepeat`/`backgroundPosition` props (see `imageFillChangePatch`
 * in fill-gradient-helpers.ts). The base row previously only passed
 * `backgroundImage`, so ColorInput treated every sibling layer as having no
 * size/repeat/position of its own — switching the base swatch to Image then
 * rebuilt those three properties as a single-entry list against the real
 * N+1-layer backgroundImage stack, corrupting every existing gradient/image
 * layer's size/repeat/position via CSS background-layer-list cycling (e.g.
 * an existing "cover" silently became "auto").
 *
 * There is no React Testing Library in this app, but `layout-properties.test.tsx`
 * establishes the pattern of rendering with `react-dom/server` and asserting
 * on the resulting markup, so this file follows the same approach: stub out
 * `ColorInput` to surface the exact props it receives, then assert the base
 * row's `<ColorInput>` is wired with the real backgroundSize/backgroundRepeat/
 * backgroundPosition values instead of leaving them empty.
 */

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "../types";
import {
  baseFillLayerSourceProps,
  FillProperties,
  shouldUseTextFill,
} from "./fill-properties";

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
    ColorInput: (props: {
      value: string;
      backgroundImage?: string;
      backgroundSize?: string;
      backgroundRepeat?: string;
      backgroundPosition?: string;
      supportsLayeredFills?: boolean;
      singlePaint?: boolean;
      supportedPaintTypes?: string[];
    }) =>
      createElement("div", {
        "data-testid": "base-fill-color-input",
        "data-value": props.value,
        "data-background-image": props.backgroundImage ?? "",
        "data-background-size": props.backgroundSize ?? "",
        "data-background-repeat": props.backgroundRepeat ?? "",
        "data-background-position": props.backgroundPosition ?? "",
        "data-supports-layered-fills": String(
          props.supportsLayeredFills ?? false,
        ),
        "data-single-paint": String(props.singlePaint ?? false),
        "data-supported-paint-types":
          props.supportedPaintTypes?.join(",") ?? "",
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

describe("baseFillLayerSourceProps", () => {
  it("sources all four background layer props together for a non-text fill", () => {
    expect(
      baseFillLayerSourceProps(
        {
          backgroundImage: "url(a.png), linear-gradient(red, blue)",
          backgroundSize: "cover, 100% 100%",
          backgroundRepeat: "no-repeat, repeat",
          backgroundPosition: "center, 0% 0%",
        },
        false,
      ),
    ).toEqual({
      backgroundImage: "url(a.png), linear-gradient(red, blue)",
      backgroundSize: "cover, 100% 100%",
      backgroundRepeat: "no-repeat, repeat",
      backgroundPosition: "center, 0% 0%",
    });
  });

  it("sources text gradient layers and their sibling properties", () => {
    expect(
      baseFillLayerSourceProps(
        {
          backgroundImage: "linear-gradient(red, blue)",
          backgroundSize: "100% 100%",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center",
        },
        false,
      ),
    ).toEqual({
      backgroundImage: "linear-gradient(red, blue)",
      backgroundSize: "100% 100%",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center",
    });
  });

  it("keeps SVG shape fills out of the CSS background layer stack", () => {
    expect(
      baseFillLayerSourceProps(
        {
          backgroundImage: "url(a.png)",
          backgroundSize: "cover",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center",
        },
        true,
      ),
    ).toEqual({
      backgroundImage: "",
      backgroundSize: "",
      backgroundRepeat: "",
      backgroundPosition: "",
    });
  });
});

describe("FillProperties base row — image layer prop wiring", () => {
  it("keeps the Fill section empty for an open Pen path", () => {
    const openPath = renderToStaticMarkup(
      createElement(FillProperties, {
        element: element({
          tagName: "svg",
          primitiveKind: "path",
          vectorStrokeCanAlign: false,
          computedStyles: {
            fill: "#000000",
            fillOpacity: "0",
            stroke: "#000000",
            strokeWidth: "1px",
          },
          inlineStyles: { fill: "none" },
        }),
        onStyleChange: vi.fn(),
      }),
    );
    const filledOpenPath = renderToStaticMarkup(
      createElement(FillProperties, {
        element: element({
          tagName: "svg",
          primitiveKind: "path",
          vectorStrokeCanAlign: false,
          computedStyles: {
            fill: "#123456",
            fillOpacity: "0",
            stroke: "#000000",
            strokeWidth: "1px",
          },
          inlineStyles: { fill: "#123456" },
        }),
        onStyleChange: vi.fn(),
      }),
    );
    const closedPath = renderToStaticMarkup(
      createElement(FillProperties, {
        element: element({
          tagName: "svg",
          primitiveKind: "path",
          vectorStrokeCanAlign: true,
          computedStyles: { fill: "#000000" },
          inlineStyles: { fill: "#000000" },
        }),
        onStyleChange: vi.fn(),
      }),
    );

    expect(openPath).toContain("editPanel.sections.fill");
    expect(openPath).toContain('aria-label="editPanel.labels.addFill"');
    expect(openPath).not.toContain('data-testid="base-fill-color-input"');
    expect(filledOpenPath).toContain('data-testid="base-fill-color-input"');
    expect(closedPath).toContain('data-testid="base-fill-color-input"');
  });

  it("keeps an authored vector gradient visible on an open Pen path", () => {
    const gradient = "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)";
    const markup = renderToStaticMarkup(
      createElement(FillProperties, {
        element: element({
          tagName: "svg",
          primitiveKind: "path",
          vectorStrokeCanAlign: false,
          computedStyles: {
            fill: "url(#vector-fill-gradient)",
            fillOpacity: "0",
          },
          inlineStyles: { "--an-vector-fill-gradient": gradient },
        }),
        onStyleChange: vi.fn(),
      }),
    );

    expect(markup).toContain('data-testid="base-fill-color-input"');
    expect(markup).toContain(`data-value="${gradient}"`);
    expect(markup).toContain(
      'data-supported-paint-types="solid,linear,radial"',
    );
  });

  it("offers native linear and radial fill paints for SVG shapes", () => {
    const gradient = "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)";
    const markup = renderToStaticMarkup(
      createElement(FillProperties, {
        element: element({
          tagName: "svg",
          primitiveKind: "path",
          computedStyles: {
            fill: "url(#vector-fill-gradient)",
          },
          inlineStyles: { "--an-vector-fill-gradient": gradient },
        }),
        onStyleChange: vi.fn(),
      }),
    );

    expect(markup).toContain(`data-value="${gradient}"`);
    expect(markup).toContain('data-background-image=""');
    expect(markup).toContain(
      'data-supported-paint-types="solid,linear,radial"',
    );
    expect(markup).toContain('data-supports-layered-fills="false"');
    expect(markup).toContain('data-single-paint="true"');
  });

  it("omits the empty base picker but keeps the converted gradient row", () => {
    const el = element({
      computedStyles: {
        backgroundColor: "rgba(255, 0, 0, 0)",
        backgroundImage: "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)",
      },
    });

    const markup = renderToStaticMarkup(
      createElement(FillProperties, {
        element: el,
        onStyleChange: vi.fn(),
        onStylesChange: vi.fn(),
      }),
    );

    expect(markup).not.toContain('data-testid="base-fill-color-input"');
    expect(markup).toContain("Linear gradient 1");
    expect(markup).toContain('aria-label="editPanel.labels.removeLayer"');
  });

  it("wires backgroundSize/backgroundRepeat/backgroundPosition onto the base row's ColorInput, not just backgroundImage", () => {
    const el = element({
      computedStyles: {
        backgroundColor: "rgba(255,255,255,1)",
        backgroundImage: "url(hero.png), linear-gradient(red, blue)",
        backgroundSize: "cover, 100% 100%",
        backgroundRepeat: "no-repeat, repeat",
        backgroundPosition: "center, 0% 0%",
      },
    });

    const markup = renderToStaticMarkup(
      createElement(FillProperties, {
        element: el,
        onStyleChange: vi.fn(),
        onStylesChange: vi.fn(),
      }),
    );

    expect(markup).toContain('data-background-image="url(hero.png)');
    expect(markup).toContain('data-background-size="cover, 100% 100%"');
    expect(markup).toContain('data-background-repeat="no-repeat, repeat"');
    expect(markup).toContain('data-background-position="center, 0% 0%"');
  });

  it("uses a visible background for a text-bearing control", () => {
    const markup = renderToStaticMarkup(
      createElement(FillProperties, {
        element: element({
          tagName: "button",
          hasOwnText: true,
          textContent: "Listen now",
          primitiveKind: undefined,
          childElementCount: 0,
          computedStyles: {
            color: "#ffffff",
            backgroundColor: "#0f766e",
          },
        }),
        onStyleChange: vi.fn(),
        onStylesChange: vi.fn(),
      }),
    );

    expect(markup).toContain('data-value="#0f766e"');
  });

  it("uses a visible gradient for a text-bearing control with a transparent background color", () => {
    const el = element({
      tagName: "button",
      hasOwnText: true,
      textContent: "Listen now",
      primitiveKind: undefined,
      childElementCount: 0,
      computedStyles: {
        color: "#ffffff",
        backgroundColor: "rgba(0, 0, 0, 0)",
        backgroundImage: "linear-gradient(90deg, #0f766e, #14b8a6)",
      },
    });

    expect(shouldUseTextFill(el, el.computedStyles)).toBe(false);
  });

  it("pairs layered image and clip values before choosing the fill target", () => {
    const el = element({
      tagName: "span",
      textContent: "Listen now",
      computedStyles: {
        color: "transparent",
        backgroundColor: "rgb(0 0 0 / 0)",
        backgroundImage: "none, linear-gradient(black, white)",
        backgroundClip: "text, border-box",
      },
    });

    expect(shouldUseTextFill(el, el.computedStyles)).toBe(false);
  });

  it("keeps layers paired to text clips on the text-fill path", () => {
    const el = element({
      tagName: "span",
      textContent: "Listen now",
      computedStyles: {
        color: "transparent",
        backgroundColor: "rgb(0 0 0 / 0)",
        backgroundImage:
          "linear-gradient(red, blue), linear-gradient(black, white)",
        backgroundClip: "text, text",
      },
    });

    expect(shouldUseTextFill(el, el.computedStyles)).toBe(true);
  });

  it("repeats a shorter clip list across visible background layers", () => {
    const el = element({
      tagName: "span",
      textContent: "Listen now",
      computedStyles: {
        color: "transparent",
        backgroundColor: "rgb(0 0 0 / 0)",
        backgroundImage:
          "linear-gradient(red, blue), linear-gradient(black, white)",
        backgroundClip: "text",
      },
    });

    expect(shouldUseTextFill(el, el.computedStyles)).toBe(true);
  });

  it("recognizes fully transparent modern computed colors", () => {
    const el = element({
      tagName: "span",
      textContent: "Listen now",
      computedStyles: {
        color: "#111827",
        backgroundColor: "rgb(0 0 0 / 0)",
      },
    });

    expect(shouldUseTextFill(el, el.computedStyles)).toBe(true);
  });

  it("does not treat none-only background layers as visible paint", () => {
    const el = element({
      tagName: "span",
      textContent: "Listen now",
      computedStyles: {
        color: "#111827",
        backgroundColor: "rgb(0 0 0 / 0)",
        backgroundImage: "none, none",
      },
    });

    expect(shouldUseTextFill(el, el.computedStyles)).toBe(true);
  });

  it("keeps mixed background paint on the text-fill path", () => {
    const el = element({
      tagName: "span",
      textContent: "Listen now",
      computedStyles: {
        color: "#111827",
        backgroundColor: "Mixed",
        backgroundImage: "Mixed",
        backgroundClip: "Mixed",
      },
    });

    expect(shouldUseTextFill(el, el.computedStyles)).toBe(true);
  });

  it("offers gradient layers but not image paints for a text fill selection", () => {
    const el = element({
      tagName: "span",
      computedStyles: {
        color: "#000000",
        backgroundImage: "linear-gradient(red, blue)",
        backgroundClip: "text",
        backgroundSize: "100% 100%",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center",
      },
    });

    const markup = renderToStaticMarkup(
      createElement(FillProperties, {
        element: el,
        onStyleChange: vi.fn(),
        onStylesChange: vi.fn(),
      }),
    );

    expect(markup).toContain(
      'data-background-image="linear-gradient(red, blue)"',
    );
    expect(markup).toContain('data-background-size="100% 100%"');
    expect(markup).toContain('data-background-repeat="no-repeat"');
    expect(markup).toContain('data-background-position="center"');
    expect(markup).toContain('data-supports-layered-fills="true"');
    expect(markup).toContain(
      'data-supported-paint-types="solid,linear,radial,angular,diamond"',
    );
    expect(markup).not.toContain('aria-label="editPanel.labels.addFill"');
  });

  it("keeps the replace action for mixed text fills", () => {
    const el = element({
      tagName: "span",
      computedStyles: {
        color: "Mixed",
      },
    });

    const markup = renderToStaticMarkup(
      createElement(FillProperties, {
        element: el,
        onStyleChange: vi.fn(),
        onStylesChange: vi.fn(),
      }),
    );

    expect(markup).toContain('aria-label="editPanel.labels.addFill"');
    expect(markup).toContain("Click + to replace mixed content");
  });
});

describe("FillProperties layer sizing", () => {
  it("restores a hidden fill's cyclic size after reordering it", async () => {
    let inlineStyles: Record<string, string> = {
      backgroundColor: "transparent",
      backgroundImage: "url(a.png), url(b.png), url(c.png)",
      backgroundSize: "cover, contain",
      backgroundRepeat: "no-repeat, repeat-x",
      backgroundPosition: "left, right",
    };
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onStyleChange = vi.fn((property: string, value: string) => {
      inlineStyles = { ...inlineStyles, [property]: value };
    });
    const onStylesChange = vi.fn((styles: Record<string, string>) => {
      inlineStyles = { ...inlineStyles, ...styles };
    });
    const mount = async () => {
      await act(async () => {
        root.render(
          createElement(FillProperties, {
            element: element({
              selector: ".fills",
              computedStyles: { ...inlineStyles },
              inlineStyles: { ...inlineStyles },
            }),
            onStyleChange,
            onStylesChange,
          }),
        );
      });
    };
    const click = async (label: string, index = 0) => {
      const button = Array.from(host.querySelectorAll("button")).filter(
        (candidate) => candidate.getAttribute("aria-label") === label,
      )[index];
      if (!button) throw new Error(`missing button: ${label} (${index})`);
      await act(async () => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await mount();
    };

    await mount();
    await click("editPanel.labels.hideLayer", 2);
    expect(inlineStyles.backgroundSize).toBe("cover, contain, 0px 0px");

    const handles = host.querySelectorAll<HTMLElement>(
      '[aria-label="editPanel.labels.reorderLayer"]',
    );
    const source = handles[2];
    const sourceRow = source?.closest<HTMLElement>(
      "[data-inspector-action-rail]",
    );
    const targetRow = handles[0]?.closest<HTMLElement>(
      "[data-inspector-action-rail]",
    );
    if (!source || !sourceRow || !targetRow) {
      throw new Error("fill drag rows were not rendered");
    }
    const dataTransfer = {
      setData: () => {},
      effectAllowed: "",
    };
    await act(async () => {
      const start = new Event("dragstart", { bubbles: true });
      Object.defineProperty(start, "dataTransfer", { value: dataTransfer });
      source.dispatchEvent(start);
    });
    await act(async () => {
      targetRow.dispatchEvent(new Event("drop", { bubbles: true }));
    });
    await mount();
    expect(inlineStyles.backgroundSize).toBe("0px 0px, cover, contain");

    await click("editPanel.labels.showLayer");
    expect(inlineStyles.backgroundSize).toBe("cover, cover, contain");
    await act(async () => root.unmount());
    host.remove();
  });
});
