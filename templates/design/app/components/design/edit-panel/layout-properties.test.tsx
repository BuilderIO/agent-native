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
    // Columns are inline-authored (fill); rows are stylesheet-authored —
    // no inline gridTemplateRows, so their sizing is unknown and a change
    // that doesn't touch them must not fabricate a rows template.
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
    // Gap-only change: neither template is written.
    expect(
      gridTemplatePatchForChange(previous, { ...previous, columnGap: 16 }),
    ).toEqual({});
    // Column count change on the inline-authored axis: only columns write;
    // the stylesheet-authored rows axis stays untouched.
    expect(
      gridTemplatePatchForChange(previous, { ...previous, columns: 3 }),
    ).toEqual({ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" });
    // First grid conversion (no previous value) writes both axes — with no
    // prior state, `skipAxis` has nothing to skip on.
    expect(gridTemplatePatchForChange(undefined, previous)).toEqual({
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gridTemplateRows: "repeat(2, minmax(0, 1fr))",
    });
  });

  it("marks an unauthored grid axis unknown — never reads track sizing off a computed template", () => {
    // Without an inline template the browser's resolved px list is all there
    // is; a matrix or sizing commit built on it froze fill/hug tracks into
    // fixed px ("repeat(2, 50px)", "40px 60px"). Only the track COUNT is
    // browser-resolved fact, so sizing is reported "custom" + unknown rather
    // than guessed as "fill".
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
    // Clipping belongs to containers. A rectangle has nothing to clip, so the
    // control is not offered here — see the frame case below.
    expect(markup).not.toContain("Clip content");
  });

  it("offers Clip content on a frame, not on a drawn shape or text", () => {
    // Clipping is a container's decision. A screen is clipped from birth (see
    // blankScreenHtml) rather than through this toggle.
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
    // What a board-drawn rectangle actually looks like here: no primitiveKind,
    // so a container-tag test cannot tell it apart from a generated `div`.
    expect(shown({ tagName: "div", sourceId: "draft-rect-1" })).toBe(false);
    expect(shown({ primitiveKind: "text", sourceId: "text-1" })).toBe(false);
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
          // A frame, so the mixed overflow this asserts on has a control to
          // render into — clipping is offered on containers only.
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
    // No inline template, but the element already renders as a grid: the
    // tracks are authored somewhere this inspector cannot read (a
    // stylesheet rule, a class). Only the computed track count is fact.
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

    // A bare count edit doesn't pick a sizing — nothing is written, so the
    // matrix visibly snaps back to the authored tracks instead of
    // overwriting them with a fabricated fill template.
    expect(
      gridTemplatePatchForChange(previous, { ...previous, columns: 3 }),
    ).toEqual({});
    expect(
      gridTemplatePatchForChange(previous, { ...previous, columnGap: 16 }),
    ).toEqual({});

    // Picking a sizing explicitly is the user's intent and writes as usual.
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
    // An authored inline-grid (or a stylesheet-authored gridAutoFlow like
    // "dense") must survive a track/gap edit, not get clobbered back to
    // display:"grid"/gridAutoFlow:"row".
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
    // Only the edited axis is written: the authored flow and the untouched
    // column template stay out of the patch entirely.
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

    // A leftover authored "column" on an element that is no longer a grid IS
    // overwritten by the conversion's gridAutoFlow:"row", so the snapshot has
    // to record the newly authored value — otherwise the panel keeps reporting
    // "column" for an element the canvas now lays out in rows.
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
    // Already a grid: the whole patch is empty, regardless of what
    // currentStyles carries — a computed/resolved template ("80px 80px"),
    // an authored gridAutoFlow ("dense"), or the multi-selection
    // MIXED_VALUE sentinel on any key. Nothing here is safe to echo back:
    // currentStyles merges computed under inline, so an unauthored
    // (stylesheet/class) template would otherwise serialize as its
    // resolved px list, and a differing multi-selection value as the
    // literal string "Mixed". This also means an existing inline-grid is
    // preserved — by touching nothing (including display) at all.
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

    // Converting a non-grid element (flex -> grid) still needs the full
    // defaults.
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
    // mixedElementFromSelection puts MIXED_VALUE ("Mixed") in inlineStyles
    // when a multi-selection's elements differ on this axis — parsing it as
    // a template would fabricate a bogus single-track custom grid.
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
    // The non-mixed rows axis reads normally — inline-authored, known.
    expect(previous.rowsMixed).toBeFalsy();
    expect(previous.rowSizingUnknown).toBeFalsy();
    expect(previous.rowSizing).toBe("hug");

    // Picking a sizing on the mixed axis still writes nothing: the count
    // is unknowable per element in the selection.
    expect(
      gridTemplatePatchForChange(previous, {
        ...previous,
        columns: 3,
        columnSizing: "fill",
      }),
    ).toEqual({});
    // A change on the non-mixed rows axis writes as usual.
    expect(
      gridTemplatePatchForChange(previous, { ...previous, rows: 3 }),
    ).toEqual({ gridTemplateRows: "repeat(3, max-content)" });
  });

  it("trusts isGridContainer over a Mixed computed display", () => {
    // A multi-selection where display itself differs per element carries
    // MIXED_VALUE in computedStyles.display; the bridge's isGridContainer
    // (every selected element is a grid container) is still authoritative.
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
    // Two multi-selected grids can share the same authored
    // "repeat(2, minmax(0, 1fr))" while sitting at different widths, which
    // resolves to different computed px lists ("100px 100px" vs
    // "150px 150px" -> sameOrMixed collapses that to "Mixed"). That
    // per-element resolved difference must not mark the AUTHORED template
    // mixed — only a differing INLINE template does that.
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
    // Unlike the stylesheet-unknown case above, this axis IS inline-authored
    // and known — but still non-uniform, so there is no formula to
    // regenerate a new track count from without discarding the authored
    // tracks.
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
