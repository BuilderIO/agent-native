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
    }) =>
      createElement("div", {
        "data-testid": "vector-stroke-paint",
        "data-value": props.value,
        "data-supported-paint-types": props.supportedPaintTypes?.join(","),
        "data-supports-layered-fills": String(
          props.supportsLayeredFills ?? false,
        ),
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
    expect(markup).toContain(
      'data-value="linear-gradient(90deg, #ff0000 0%, #0000ff 100%)"',
    );
  });
});
