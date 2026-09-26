import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "../types";
import { inferElementSizing } from "./element-classification";
import { patchAuthoredInlineStyles } from "./interaction-state-helpers";
import {
  autoLayoutStylesForFlow,
  gridChangePatch,
  gridTemplateForTracks,
  gridTemplatePatchForChange,
  gridValueForElement,
  justifyContentForGapMode,
  LayoutContextProperties,
  parseGridTemplate,
} from "./layout-properties";

vi.mock("@agent-native/core/client/i18n", () => ({
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
  it("infers sizing modes from authored values instead of resolved pixels", () => {
    expect(
      inferElementSizing(
        element({
          inlineStyles: { width: "fit-content", height: "auto" },
          computedStyles: {
            display: "block",
            width: "820px",
            height: "135.4px",
          },
        }),
        "horizontal",
      ),
    ).toBe("hug");
    expect(
      inferElementSizing(
        element({
          inlineStyles: { width: "100%" },
          computedStyles: {
            display: "block",
            width: "820px",
            height: "135.4px",
          },
        }),
        "horizontal",
      ),
    ).toBe("fill");
  });

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

  it("leaves an untouched grid axis alone so stylesheet-authored tracks survive", () => {
    const previous = gridValueForElement(
      element({
        isGridContainer: true,
        inlineStyles: {
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        },
        computedStyles: {
          display: "grid",
          gridTemplateColumns: "50px 50px",
          gridTemplateRows: "40px 60px",
          columnGap: "0px",
          rowGap: "0px",
          width: "100px",
          height: "100px",
        },
      }),
    );
    expect(
      gridTemplatePatchForChange(previous, { ...previous, columnGap: 16 }),
    ).toEqual({});
    expect(
      gridTemplatePatchForChange(previous, { ...previous, columns: 3 }),
    ).toEqual({ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" });
    expect(gridTemplatePatchForChange(undefined, previous)).toEqual({
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gridTemplateRows: "repeat(2, minmax(0, 1fr))",
    });
  });

  it("marks an unauthored grid axis unknown — never reads track sizing off a computed template", () => {
    const grid = gridValueForElement(
      element({
        isGridContainer: true,
        inlineStyles: {},
        computedStyles: {
          display: "grid",
          gridTemplateColumns: "50px 50px",
          gridTemplateRows: "40px 60px",
          columnGap: "16px",
          rowGap: "16px",
          width: "100px",
          height: "100px",
        },
      }),
    );
    expect(grid).toMatchObject({
      columns: 2,
      columnSizing: "custom",
      columnSizingUnknown: true,
      columnTemplate: "",
      rows: 2,
      rowSizing: "custom",
      rowSizingUnknown: true,
      rowTemplate: "",
    });
    expect(grid.columnSizing).not.toBe("fixed");
    expect(grid.rowSizing).not.toBe("fixed");
    expect(grid.columnSize).not.toBe(50);
    expect(grid.rowSize).not.toBe(50);
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
    expect(markup).not.toContain("Clip content");
  });

  it("offers Clip content on a frame, not on a drawn shape or text", () => {
    const shown = (info: Parameters<typeof element>[0]) =>
      renderToStaticMarkup(
        createElement(LayoutContextProperties, {
          element: element(info),
          onStyleChange: vi.fn(),
        }),
      ).includes("Clip content");

    expect(shown({ primitiveKind: "frame", sourceId: "frame-1" })).toBe(true);
    expect(shown({ primitiveKind: "rectangle", sourceId: "rect-1" })).toBe(
      false,
    );
    expect(shown({ tagName: "div", sourceId: "draft-rect-1" })).toBe(false);
    expect(shown({ primitiveKind: "text", sourceId: "text-1" })).toBe(false);
  });

  it("maps gap-mode Auto to space-between and restores the last packed alignment on Fixed", () => {
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
          primitiveKind: "frame",
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

  it("marks an unauthored grid axis unknown and refuses a bare count edit on it", () => {
    const previous = gridValueForElement(
      element({
        isGridContainer: true,
        inlineStyles: {},
        computedStyles: {
          display: "grid",
          gridTemplateColumns: "80px 80px",
          width: "160px",
          height: "80px",
        },
      }),
    );
    expect(previous).toMatchObject({
      columns: 2,
      columnSizing: "custom",
      columnSizingUnknown: true,
    });

    expect(
      gridTemplatePatchForChange(previous, { ...previous, columns: 3 }),
    ).toEqual({});
    expect(
      gridTemplatePatchForChange(previous, { ...previous, columnGap: 16 }),
    ).toEqual({});

    expect(
      gridTemplatePatchForChange(previous, {
        ...previous,
        columns: 3,
        columnSizing: "fill",
      }),
    ).toEqual({ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" });
    expect(
      gridTemplatePatchForChange(previous, {
        ...previous,
        columns: 3,
        columnSizing: "hug",
      }),
    ).toEqual({ gridTemplateColumns: "repeat(3, max-content)" });
  });

  it("keeps the fill default for a non-grid element with no inline template", () => {
    const grid = gridValueForElement(
      element({
        computedStyles: { display: "flex", width: "160px", height: "80px" },
      }),
    );
    expect(grid.columnSizing).toBe("fill");
    expect(grid.columnSizingUnknown).toBeUndefined();
  });

  it("omits display and gridAutoFlow for an already-grid element, includes both converting from flex", () => {
    const gridElement = element({
      isGridContainer: true,
      inlineStyles: {},
      computedStyles: {
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gridTemplateRows: "repeat(1, max-content)",
        gridAutoFlow: "dense",
        columnGap: "0px",
        rowGap: "0px",
        width: "160px",
        height: "80px",
      },
    });
    const gridValue = gridValueForElement(gridElement);
    const gridPatch = gridChangePatch(gridElement, gridValue, {
      ...gridValue,
      columnGap: 8,
    });
    expect(gridPatch).not.toHaveProperty("display");
    expect(gridPatch).not.toHaveProperty("gridAutoFlow");

    const inlineGridElement = element({
      isGridContainer: true,
      inlineStyles: {},
      computedStyles: {
        display: "inline-grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gridTemplateRows: "repeat(1, max-content)",
        columnGap: "0px",
        rowGap: "0px",
        width: "160px",
        height: "80px",
      },
    });
    const inlineGridValue = gridValueForElement(inlineGridElement);
    expect(
      gridChangePatch(inlineGridElement, inlineGridValue, {
        ...inlineGridValue,
        columnGap: 8,
      }),
    ).not.toHaveProperty("display");

    const flexElement = element({
      isFlexContainer: true,
      computedStyles: { display: "flex", width: "160px", height: "80px" },
    });
    const newGridValue = {
      columns: 2,
      rows: 1,
      columnSizing: "fill" as const,
      rowSizing: "fill" as const,
      columnGap: 0,
      rowGap: 0,
    };
    const flexPatch = gridChangePatch(flexElement, undefined, newGridValue);
    expect(flexPatch.display).toBe("grid");
    expect(flexPatch.gridAutoFlow).toBe("row");
  });

  it("keeps an authored grid-auto-flow readable across a grid write", () => {
    const denseGrid = element({
      isGridContainer: true,
      inlineStyles: {
        gridAutoFlow: "dense",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gridTemplateRows: "repeat(1, max-content)",
      },
      computedStyles: {
        display: "grid",
        gridTemplateColumns: "60px 60px",
        gridTemplateRows: "40px",
        gridAutoFlow: "row dense",
        columnGap: "0px",
        rowGap: "0px",
        width: "120px",
        height: "40px",
      },
    });
    const denseValue = gridValueForElement(denseGrid);
    const rowWrite = gridChangePatch(denseGrid, denseValue, {
      ...denseValue,
      rows: 2,
    });
    expect(rowWrite).not.toHaveProperty("gridAutoFlow");
    expect(rowWrite).not.toHaveProperty("gridTemplateColumns");
    expect(rowWrite.gridTemplateRows).toBe("repeat(2, max-content)");
    expect(
      patchAuthoredInlineStyles(denseGrid.inlineStyles, rowWrite),
    ).toMatchObject({
      gridAutoFlow: "dense",
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gridTemplateRows: "repeat(2, max-content)",
    });

    const convertedBack = element({
      isFlexContainer: true,
      inlineStyles: { gridAutoFlow: "column" },
      computedStyles: { display: "flex", width: "120px", height: "40px" },
    });
    const conversion = gridChangePatch(convertedBack, undefined, {
      columns: 2,
      rows: 1,
      columnSizing: "fill" as const,
      rowSizing: "fill" as const,
      columnGap: 0,
      rowGap: 0,
    });
    expect(conversion.gridAutoFlow).toBe("row");
    expect(
      patchAuthoredInlineStyles(convertedBack.inlineStyles, conversion),
    ).toMatchObject({ gridAutoFlow: "row" });
  });

  it("re-committing Grid on an existing grid is a pure no-op, applies full defaults only when converting", () => {
    expect(
      autoLayoutStylesForFlow(
        "grid",
        { display: "grid", gridTemplateColumns: "80px 80px" },
        true,
      ),
    ).toEqual({});
    expect(
      autoLayoutStylesForFlow(
        "grid",
        { display: "grid", gridAutoFlow: "dense" },
        true,
      ),
    ).toEqual({});
    expect(
      autoLayoutStylesForFlow(
        "grid",
        {
          display: "grid",
          gridTemplateColumns: "Mixed",
          gridAutoFlow: "Mixed",
        },
        true,
      ),
    ).toEqual({});

    expect(autoLayoutStylesForFlow("grid", { display: "flex" }, false)).toEqual(
      {
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gridTemplateRows: "repeat(1, max-content)",
        gridAutoFlow: "row",
      },
    );
    expect(autoLayoutStylesForFlow("grid")).toMatchObject({ display: "grid" });
  });

  it("marks a mixed grid axis unknown from the sentinel, not a plain unauthored one", () => {
    const previous = gridValueForElement(
      element({
        isGridContainer: true,
        inlineStyles: {
          gridTemplateColumns: "Mixed",
          gridTemplateRows: "repeat(2, max-content)",
        },
        computedStyles: {
          display: "grid",
          gridTemplateColumns: "80px 80px",
          gridTemplateRows: "40px 40px",
          columnGap: "0px",
          rowGap: "0px",
          width: "160px",
          height: "80px",
        },
      }),
    );
    expect(previous).toMatchObject({
      columnsMixed: true,
      columnSizingUnknown: true,
      columnSizing: "custom",
    });
    expect(previous.rowsMixed).toBeFalsy();
    expect(previous.rowSizingUnknown).toBeFalsy();
    expect(previous.rowSizing).toBe("hug");

    expect(
      gridTemplatePatchForChange(previous, {
        ...previous,
        columns: 3,
        columnSizing: "fill",
      }),
    ).toEqual({});
    expect(
      gridTemplatePatchForChange(previous, { ...previous, rows: 3 }),
    ).toEqual({ gridTemplateRows: "repeat(3, max-content)" });
  });

  it("trusts isGridContainer over a Mixed computed display", () => {
    const grid = gridValueForElement(
      element({
        isGridContainer: true,
        inlineStyles: {},
        computedStyles: {
          display: "Mixed",
          gridTemplateColumns: "80px 80px",
          width: "160px",
          height: "80px",
        },
      }),
    );
    expect(grid.columnSizing).toBe("custom");
    expect(grid.columnSizingUnknown).toBe(true);
    expect(grid.columnSizing).not.toBe("fill");
  });

  it("trusts a shared inline template over differing computed templates across a multi-selection", () => {
    const merged = gridValueForElement(
      element({
        isGridContainer: true,
        inlineStyles: {
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gridTemplateRows: "repeat(2, minmax(0, 1fr))",
        },
        computedStyles: {
          display: "grid",
          gridTemplateColumns: "Mixed",
          gridTemplateRows: "Mixed",
          columnGap: "0px",
          rowGap: "0px",
          width: "100px",
          height: "100px",
        },
      }),
    );
    expect(merged).toMatchObject({
      columns: 2,
      columnSizing: "fill",
      columnsMixed: undefined,
      columnSizingUnknown: undefined,
    });
    expect(
      gridTemplatePatchForChange(merged, { ...merged, columns: 3 }),
    ).toEqual({ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" });
  });

  it("refuses a bare count edit on a known non-uniform custom template, writes with an explicit sizing pick", () => {
    const previous = gridValueForElement(
      element({
        isGridContainer: true,
        inlineStyles: {
          gridTemplateColumns: "96px 1fr minmax(0, 200px)",
        },
        computedStyles: {
          display: "grid",
          gridTemplateColumns: "96px 292px 200px",
          columnGap: "0px",
          rowGap: "0px",
          width: "588px",
          height: "80px",
        },
      }),
    );
    expect(previous).toMatchObject({
      columns: 3,
      columnSizing: "custom",
      columnSizingUnknown: undefined,
    });

    expect(
      gridTemplatePatchForChange(previous, { ...previous, columns: 4 }),
    ).toEqual({});
    expect(
      gridTemplatePatchForChange(previous, {
        ...previous,
        columns: 4,
        columnSizing: "fill",
      }),
    ).toEqual({ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" });
    expect(
      gridTemplatePatchForChange(previous, { ...previous, columnGap: 8 }),
    ).toEqual({});
  });
});
