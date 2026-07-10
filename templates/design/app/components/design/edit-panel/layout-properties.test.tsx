import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "../types";
import {
  autoLayoutStylesForFlow,
  gridTemplateForTracks,
  gridValueForElement,
  justifyContentForGapMode,
  LayoutContextProperties,
  parseGridTemplate,
} from "./layout-properties";

vi.mock("@agent-native/core/client", () => ({
  cn: (...inputs: Array<string | false | null | undefined>) =>
    inputs.filter(Boolean).join(" "),
  useT: () => (key: string) => key,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: unknown }) => children as never,
  TooltipTrigger: ({ children }: { children?: unknown }) => children as never,
  TooltipContent: ({ children }: { children?: unknown }) => children as never,
  TooltipProvider: ({ children }: { children?: unknown }) => children as never,
}));

function element(overrides: Partial<ElementInfo>): ElementInfo {
  return {
    tagName: "div",
    classes: [],
    computedStyles: {
      display: "block",
      width: "120px",
      height: "80px",
    },
    boundingRect: { x: 0, y: 0, width: 120, height: 80 },
    isFlexChild: false,
    isFlexContainer: false,
    childElementCount: 0,
    ...overrides,
  } as ElementInfo;
}

describe("LayoutContextProperties", () => {
  it("maps each Flow choice to one complete atomic style patch", () => {
    expect(autoLayoutStylesForFlow("normal")).toEqual({ display: "block" });
    expect(autoLayoutStylesForFlow("vertical")).toEqual({
      display: "flex",
      flexDirection: "column",
      flexWrap: "nowrap",
    });
    expect(autoLayoutStylesForFlow("horizontal")).toEqual({
      display: "flex",
      flexDirection: "row",
      flexWrap: "nowrap",
    });
    expect(autoLayoutStylesForFlow("grid")).toEqual({
      display: "grid",
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gridTemplateRows: "repeat(1, max-content)",
      gridAutoFlow: "row",
    });
  });

  it("detects real grid tracks without rewriting authored custom templates", () => {
    expect(parseGridTemplate("repeat(3, minmax(0, 1fr))")).toEqual({
      count: 3,
      sizing: "fill",
    });
    expect(parseGridTemplate("96px 1fr minmax(80px, 2fr)")).toEqual({
      count: 3,
      sizing: "custom",
    });
    expect(
      gridTemplateForTracks(
        3,
        "custom",
        undefined,
        "96px 1fr minmax(80px, 2fr)",
      ),
    ).toBe("96px 1fr minmax(80px, 2fr)");

    const grid = gridValueForElement(
      element({
        isGridContainer: true,
        inlineStyles: {
          gridTemplateColumns: "96px 1fr minmax(80px, 2fr)",
          gridTemplateRows: "repeat(2, max-content)",
        },
        computedStyles: {
          display: "grid",
          gridTemplateColumns: "96px 180px 180px",
          gridTemplateRows: "24px 24px",
          columnGap: "12px",
          rowGap: "8px",
          width: "480px",
          height: "80px",
        },
      }),
    );
    expect(grid).toMatchObject({
      columns: 3,
      columnSizing: "custom",
      columnTemplate: "96px 1fr minmax(80px, 2fr)",
      rows: 2,
      rowSizing: "hug",
      columnGap: 12,
      rowGap: 8,
    });
  });

  it("shows Flow and Padding for an empty rectangle so auto layout can be enabled before nesting", () => {
    const markup = renderToStaticMarkup(
      createElement(LayoutContextProperties, {
        element: element({
          primitiveKind: "rectangle",
          sourceId: "draft-rect-1",
        }),
        onStyleChange: vi.fn(),
      }),
    );

    expect(markup).toContain("editPanel.sections.autoLayout");
    expect(markup).toContain("Flow");
    expect(markup).toContain("Normal flow");
    expect(markup).toContain("Padding");
    expect(markup).toContain("Clip content");
  });

  it("maps gap-mode Auto to space-between and restores the last packed alignment on Fixed", () => {
    // Auto gap mode IS justify-content:space-between. Switching back to
    // Fixed must restore whatever packed (start/center/end) alignment was
    // in effect before Auto was turned on, not hard-reset to flex-start —
    // see the lastPackedJustifyRef comment in FlexContainerControls.
    expect(justifyContentForGapMode("auto", "center")).toBe("space-between");
    expect(justifyContentForGapMode("fixed", "center")).toBe("center");
    expect(justifyContentForGapMode("fixed", "flex-end")).toBe("flex-end");
  });

  it("shows ordinary sizing rather than auto-layout controls for a flex-backed text primitive", () => {
    const markup = renderToStaticMarkup(
      createElement(LayoutContextProperties, {
        element: element({
          primitiveKind: "text",
          sourceId: "draft-text-1",
          isFlexContainer: true,
          textContent: "Label",
          computedStyles: {
            display: "flex",
            width: "120px",
            height: "24px",
          },
          boundingRect: { x: 0, y: 0, width: 120, height: 24 },
        }),
        onStyleChange: vi.fn(),
      }),
    );

    expect(markup).toContain("editPanel.sections.layout");
    expect(markup).not.toContain("editPanel.sections.autoLayout");
    expect(markup).not.toContain("Normal flow");
  });

  it("passes a mixed container flow through as Mixed instead of normal flow", () => {
    const markup = renderToStaticMarkup(
      createElement(LayoutContextProperties, {
        element: element({
          tagName: "div",
          computedStyles: {
            display: "Mixed",
            flexDirection: "Mixed",
            flexWrap: "Mixed",
            justifyContent: "Mixed",
            alignItems: "Mixed",
            overflow: "Mixed",
            width: "120px",
            height: "80px",
          },
        }),
        onStyleChange: vi.fn(),
      }),
    );

    expect(markup).toContain('data-flow-value="mixed"');
    expect(markup).toContain("Mixed");
    expect(markup).toContain('aria-label="Normal flow" aria-pressed="false"');
    expect(markup).toContain('aria-label="Vertical" aria-pressed="false"');
    expect(markup).toContain('aria-label="Horizontal" aria-pressed="false"');
    expect(markup).toContain('aria-label="Grid" aria-pressed="false"');
    expect(markup).toContain("Gap mode: Mixed");
    expect(markup).toContain('aria-checked="mixed"');
    expect(markup).toContain('aria-label="top left" aria-pressed="false"');
  });
});
