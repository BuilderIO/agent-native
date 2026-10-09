// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "../types";
import { mixedElementFromSelection } from "./selection-helpers";
import { StrokeProperties } from "./stroke-properties";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: unknown }) => children,
  TooltipTrigger: ({ children }: { children?: unknown }) => children,
  TooltipContent: () => null,
  TooltipProvider: ({ children }: { children?: unknown }) => children,
}));

vi.mock("./panel-primitives", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./panel-primitives")>();
  return {
    ...actual,
    ColorInput: (props: {
      value: string;
      supportedPaintTypes?: string[];
      supportsLayeredFills?: boolean;
      singlePaint?: boolean;
    }) =>
      createElement("div", {
        "data-testid": "vector-stroke-paint",
        "data-value": props.value,
        "data-supported-paint-types": props.supportedPaintTypes?.join(","),
        "data-supports-layered-fills": String(
          props.supportsLayeredFills ?? false,
        ),
        "data-single-paint": String(props.singlePaint ?? false),
      }),
  };
});

describe("vector stroke gradient inspector", () => {
  it("exposes linear and radial paints for a selected vector", () => {
    const markup = renderToStaticMarkup(
      createElement(StrokeProperties, {
        element: {
          tagName: "svg",
          primitiveKind: "path",
          classes: [],
          computedStyles: {
            stroke: "url(#pen-1-stroke-gradient)",
            strokeWidth: "2px",
          },
          inlineStyles: {
            "--an-vector-stroke-gradient":
              "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)",
          },
          boundingRect: { x: 0, y: 0, width: 80, height: 60 },
          isFlexChild: false,
          isFlexContainer: false,
          childElementCount: 1,
          sourceId: "pen-1",
        } as ElementInfo,
        onStyleChange: vi.fn(),
      }),
    );

    expect(markup).toContain('data-testid="vector-stroke-paint"');
    expect(markup).toContain(
      'data-supported-paint-types="solid,linear,radial"',
    );
    expect(markup).toContain('data-supports-layered-fills="true"');
    expect(markup).toContain('data-single-paint="true"');
    expect(markup).toContain(
      'data-value="linear-gradient(90deg, #ff0000 0%, #0000ff 100%)"',
    );
  });

  it.each(["inlineStyles", "computedStyles"] as const)(
    "shows the mixed-content state when selected vectors have differing gradient metadata in %s",
    (gradientSource) => {
      const gradientProperty = "--an-vector-stroke-gradient";
      const makeVector = (
        tagName: "path" | "rect",
        primitiveKind: "path" | "rect",
        gradient: string,
        x: number,
      ) =>
        ({
          tagName,
          primitiveKind,
          classes: [],
          computedStyles: {
            stroke: "#111827",
            strokeWidth: "2px",
            ...(gradientSource === "computedStyles"
              ? { [gradientProperty]: gradient }
              : {}),
          },
          ...(gradientSource === "inlineStyles"
            ? { inlineStyles: { [gradientProperty]: gradient } }
            : {}),
          boundingRect: { x, y: 0, width: 80, height: 60 },
          isFlexChild: false,
          isFlexContainer: false,
        }) as ElementInfo;
      const selected = mixedElementFromSelection([
        makeVector(
          "path",
          "path",
          "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)",
          0,
        ),
        makeVector(
          "rect",
          "rect",
          "linear-gradient(90deg, #00ff00 0%, #0000ff 100%)",
          100,
        ),
      ]);
      const selectedGradient =
        gradientSource === "inlineStyles"
          ? selected?.inlineStyles?.[gradientProperty]
          : selected?.computedStyles[gradientProperty];
      const markup = renderToStaticMarkup(
        createElement(StrokeProperties, {
          element: selected!,
          onStyleChange: vi.fn(),
        }),
      );

      expect(selected?.computedStyles.stroke).toBe("#111827");
      expect(selected?.computedStyles.strokeWidth).toBe("2px");
      expect(selectedGradient).toBe("Mixed");
      expect(markup).toContain("Click + to replace mixed content");
      expect(markup).not.toContain('data-testid="vector-stroke-paint"');
    },
  );

  it("adds SVG stroke styles to a mixed selection of vector shape tags", async () => {
    const selected = mixedElementFromSelection([
      {
        tagName: "path",
        primitiveKind: "path",
        classes: [],
        computedStyles: { stroke: "none", strokeWidth: "0px" },
        boundingRect: { x: 0, y: 0, width: 80, height: 60 },
        isFlexChild: false,
        isFlexContainer: false,
      } as ElementInfo,
      {
        tagName: "rect",
        primitiveKind: "rect",
        classes: [],
        computedStyles: { strokeWidth: "0px" },
        boundingRect: { x: 100, y: 0, width: 80, height: 60 },
        isFlexChild: false,
        isFlexContainer: false,
      } as ElementInfo,
    ]);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onStyleChange = vi.fn();
    const onStylesChange = vi.fn();

    await act(async () => {
      root.render(
        createElement(StrokeProperties, {
          element: selected!,
          onStyleChange,
          onStylesChange,
        }),
      );
    });
    const addStroke = host.querySelector<HTMLButtonElement>(
      'button[aria-label="editPanel.labels.addStroke"]',
    );
    await act(async () => addStroke?.click());

    expect(onStylesChange).toHaveBeenCalledWith(
      { stroke: "#000000", strokeWidth: "1px" },
      undefined,
    );
    expect(onStyleChange).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    host.remove();
  });

  it("keeps a mixed HTML and SVG selection on CSS border strokes", async () => {
    const selected = mixedElementFromSelection([
      {
        tagName: "div",
        classes: [],
        computedStyles: {
          borderWidth: "0px",
          borderStyle: "none",
          stroke: "#111827",
          strokeWidth: "2px",
        },
        boundingRect: { x: 0, y: 0, width: 80, height: 60 },
        isFlexChild: false,
        isFlexContainer: false,
      } as ElementInfo,
      {
        tagName: "path",
        primitiveKind: "path",
        classes: [],
        computedStyles: {
          borderWidth: "0px",
          borderStyle: "none",
          stroke: "#111827",
          strokeWidth: "2px",
        },
        inlineStyles: {
          "--an-vector-stroke-gradient":
            "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)",
        },
        boundingRect: { x: 100, y: 0, width: 80, height: 60 },
        isFlexChild: false,
        isFlexContainer: false,
      } as ElementInfo,
    ]);
    expect(selected?.inlineStyles?.["--an-vector-stroke-gradient"]).toBe(
      "Mixed",
    );
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onStyleChange = vi.fn();
    const onStylesChange = vi.fn();

    await act(async () => {
      root.render(
        createElement(StrokeProperties, {
          element: selected!,
          onStyleChange,
          onStylesChange,
        }),
      );
    });
    const addStroke = host.querySelector<HTMLButtonElement>(
      'button[aria-label="editPanel.labels.addStroke"]',
    );
    await act(async () => addStroke?.click());

    expect(onStylesChange).toHaveBeenCalledWith(
      {
        borderWidth: "1px",
        borderStyle: "solid",
        borderColor: "#000000",
      },
      undefined,
    );
    expect(onStyleChange).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    host.remove();
  });

  it("offers linear paints for an inline square HTML rectangle border", () => {
    const markup = renderToStaticMarkup(
      createElement(StrokeProperties, {
        element: {
          tagName: "div",
          primitiveKind: "rectangle",
          classes: [],
          computedStyles: {
            borderWidth: "2px",
            borderStyle: "solid",
            borderColor: "#111827",
            borderTopWidth: "2px",
            borderRightWidth: "2px",
            borderBottomWidth: "2px",
            borderLeftWidth: "2px",
            borderTopStyle: "solid",
            borderRightStyle: "solid",
            borderBottomStyle: "solid",
            borderLeftStyle: "solid",
            borderTopColor: "#111827",
            borderRightColor: "#111827",
            borderBottomColor: "#111827",
            borderLeftColor: "#111827",
            outlineWidth: "0px",
            outlineStyle: "none",
          },
          inlineStyles: {
            borderWidth: "2px",
            borderStyle: "solid",
            borderColor: "transparent",
            "--an-css-border-gradient":
              "linear-gradient(90deg, #f00 0%, #00f 100%)",
            "--an-css-border-solid-color": "#111827",
          },
          boundingRect: { x: 0, y: 0, width: 80, height: 60 },
          isFlexChild: false,
          isFlexContainer: false,
          childElementCount: 0,
          sourceId: "css-rect-1",
        } as ElementInfo,
        onStyleChange: vi.fn(),
      }),
    );

    expect(markup).toContain(
      'data-value="linear-gradient(90deg, #f00 0%, #00f 100%)"',
    );
    expect(markup).toContain('data-supported-paint-types="solid,linear"');
    expect(markup).toContain('data-supports-layered-fills="true"');
    expect(markup).toContain('data-single-paint="true"');
  });

  it("keeps CSS border gradients unavailable on rounded rectangles", () => {
    const markup = renderToStaticMarkup(
      createElement(StrokeProperties, {
        element: {
          tagName: "div",
          primitiveKind: "rectangle",
          classes: [],
          computedStyles: {
            borderWidth: "2px",
            borderStyle: "solid",
            borderColor: "#111827",
            borderTopWidth: "2px",
            borderRightWidth: "2px",
            borderBottomWidth: "2px",
            borderLeftWidth: "2px",
            borderTopStyle: "solid",
            borderRightStyle: "solid",
            borderBottomStyle: "solid",
            borderLeftStyle: "solid",
            borderTopLeftRadius: "8px",
            outlineWidth: "0px",
            outlineStyle: "none",
          },
          inlineStyles: {
            borderWidth: "2px",
            borderStyle: "solid",
            borderColor: "#111827",
          },
          boundingRect: { x: 0, y: 0, width: 80, height: 60 },
          isFlexChild: false,
          isFlexContainer: false,
          childElementCount: 0,
          sourceId: "css-rect-rounded",
        } as ElementInfo,
        onStyleChange: vi.fn(),
      }),
    );
    expect(markup).toContain('data-supported-paint-types="solid"');
  });

  it("keeps CSS border gradients unavailable with authored per-side borders", () => {
    const markup = renderToStaticMarkup(
      createElement(StrokeProperties, {
        element: {
          tagName: "div",
          primitiveKind: "rectangle",
          classes: [],
          computedStyles: {
            borderWidth: "2px",
            borderStyle: "solid",
            borderColor: "#111827",
            borderTopWidth: "2px",
            borderRightWidth: "2px",
            borderBottomWidth: "2px",
            borderLeftWidth: "2px",
            borderTopStyle: "solid",
            borderRightStyle: "solid",
            borderBottomStyle: "solid",
            borderLeftStyle: "solid",
            borderTopColor: "#111827",
            borderRightColor: "#111827",
            borderBottomColor: "#111827",
            borderLeftColor: "#111827",
            outlineWidth: "0px",
            outlineStyle: "none",
          },
          inlineStyles: {
            borderTopWidth: "2px",
            borderRightWidth: "2px",
            borderBottomWidth: "2px",
            borderLeftWidth: "2px",
            borderTopStyle: "solid",
            borderRightStyle: "solid",
            borderBottomStyle: "solid",
            borderLeftStyle: "solid",
            borderTopColor: "#111827",
            borderRightColor: "#111827",
            borderBottomColor: "#111827",
            borderLeftColor: "#111827",
          },
          boundingRect: { x: 0, y: 0, width: 80, height: 60 },
          isFlexChild: false,
          isFlexContainer: false,
          childElementCount: 0,
          sourceId: "css-rect-per-side",
        } as ElementInfo,
        onStyleChange: vi.fn(),
      }),
    );

    expect(markup).toContain('data-supported-paint-types="solid"');
    expect(markup).toContain('data-supports-layered-fills="false"');
  });
});
