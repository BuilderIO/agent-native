// @vitest-environment happy-dom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "../types";
import { StrokeProperties } from "./stroke-properties";

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
