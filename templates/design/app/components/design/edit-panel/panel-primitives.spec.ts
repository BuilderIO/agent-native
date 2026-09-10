import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { commitStylePatch, resolveSpacingSideValue } from "./field-primitives";
import {
  INSPECTOR_GRID_ACTION_GUTTER_SPAN,
  INSPECTOR_GRID_ACTION_GUTTER_WIDTH_PX,
  INSPECTOR_GRID_ACTION_PAIR_SPAN,
  INSPECTOR_GRID_ACTION_SPAN,
  INSPECTOR_GRID_ACTION_WIDTH_PX,
  INSPECTOR_GRID_COLUMNS,
  INSPECTOR_GRID_PAIR_GUTTER_SPAN,
  INSPECTOR_GRID_PAIR_GUTTER_WIDTH_PX,
  INSPECTOR_GRID_PAIR_SPAN,
  INSPECTOR_GRID_PAINT_ACTION_SPAN,
  INSPECTOR_GRID_PAINT_ACTION_WIDTH_PX,
  INSPECTOR_GRID_PAINT_FIELD_SPAN,
  INSPECTOR_GRID_ROW_PX,
  INSPECTOR_GRID_STROKE_GUTTER_SPAN,
  INSPECTOR_GRID_STROKE_POSITION_SPAN,
  INSPECTOR_GRID_STROKE_WEIGHT_SPAN,
  INSPECTOR_GRID_UNIT_PX,
  InspectorActionPairGrid,
  InspectorActionRail,
  InspectorGrid,
  InspectorGridCell,
  InspectorPaintRow,
} from "./inspector-grid";
import {
  normalizeLengthValue,
  propInputKeyRequiresBlurGuard,
} from "./panel-primitives";

describe("InspectorGrid", () => {
  it("keeps the authored 28-column baseline and explicit spans in markup", () => {
    const markup = renderToStaticMarkup(
      createElement(
        InspectorGrid,
        null,
        createElement(InspectorGridCell, { span: 10 }, "Label"),
        createElement(InspectorGridCell, { span: 18 }, "Control"),
      ),
    );

    expect(INSPECTOR_GRID_COLUMNS).toBe(28);
    expect(INSPECTOR_GRID_UNIT_PX).toBe(8);
    expect(INSPECTOR_GRID_ROW_PX).toBe(24);
    expect(markup).toContain('data-inspector-grid="true"');
    expect(markup).toContain('data-inspector-layout="columns"');
    expect(markup).toContain('data-inspector-span="10"');
    expect(markup).toContain('style="grid-column:span 10 / span 10"');
    expect(markup).toContain('data-inspector-span="18"');
    expect(markup).toContain('style="grid-column:span 18 / span 18"');
  });

  it("keeps paired fields equal with and without a trailing action", () => {
    expect(INSPECTOR_GRID_PAIR_SPAN * 2 + INSPECTOR_GRID_PAIR_GUTTER_SPAN).toBe(
      INSPECTOR_GRID_COLUMNS,
    );
    expect(
      INSPECTOR_GRID_ACTION_PAIR_SPAN * 2 +
        INSPECTOR_GRID_ACTION_GUTTER_SPAN * 2 +
        INSPECTOR_GRID_ACTION_SPAN,
    ).toBe(INSPECTOR_GRID_COLUMNS);
    expect(INSPECTOR_GRID_ACTION_SPAN).toBe(4);
    expect(INSPECTOR_GRID_PAIR_GUTTER_WIDTH_PX).toBe(16);
    expect(INSPECTOR_GRID_ACTION_GUTTER_WIDTH_PX).toBe(8);
    expect(INSPECTOR_GRID_ACTION_WIDTH_PX).toBe(32);
  });

  it("reserves the same action-pair tracks when a row has no action", () => {
    const markup = renderToStaticMarkup(
      createElement(InspectorActionPairGrid, {
        left: "Horizontal alignment",
        right: "Vertical alignment",
      }),
    );

    expect(markup.match(/data-inspector-span="11"/g)).toHaveLength(2);
    expect(markup.match(/data-inspector-span="1"/g)).toHaveLength(2);
    expect(markup).toContain('data-inspector-span="4"');
    expect(markup).toContain('data-inspector-layout="action-pair"');
  });

  it("marks stacked labels and controls with the shared fixed action layout", () => {
    const markup = renderToStaticMarkup(
      createElement(InspectorGrid, {
        layout: "label-action-rows",
        children: Array.from({ length: 10 }, (_, index) =>
          createElement(InspectorGridCell, { key: index, span: 1 }, index),
        ),
      }),
    );

    expect(markup).toContain('data-inspector-layout="label-action-rows"');
    expect(markup.match(/data-inspector-grid-cell="true"/g)).toHaveLength(10);
  });

  it("puts every header action on the shared fixed-width rail", () => {
    const markup = renderToStaticMarkup(
      createElement(InspectorGrid, {
        layout: "header-actions",
        children: [
          createElement(InspectorGridCell, { span: 20, key: "title" }, "Fill"),
          createElement(
            InspectorGridCell,
            { span: 8, key: "actions" },
            createElement(InspectorActionRail, {
              children: [
                createElement("button", { key: "style" }, "Style"),
                createElement("button", { key: "add" }, "Add"),
              ],
            }),
          ),
        ],
      }),
    );

    expect(markup).toContain('data-inspector-layout="header-actions"');
    expect(markup).toContain('data-inspector-action-rail="fixed"');
    expect(markup).toContain('class="design-inspector-action-rail"');
  });

  it("marks legacy two-control rows for the fixed-gutter pair flow", () => {
    const markup = renderToStaticMarkup(
      createElement(InspectorGrid, {
        layout: "pair-flow",
        children: [
          createElement(InspectorGridCell, { span: 14, key: "first" }, "First"),
          createElement(
            InspectorGridCell,
            { span: 14, key: "second" },
            "Second",
          ),
        ],
      }),
    );

    expect(markup).toContain('data-inspector-layout="pair-flow"');
    expect(markup.match(/data-inspector-span="14"/g)).toHaveLength(2);
  });

  it("pins every paint and effect row to fixed 32px action slots", () => {
    const markup = renderToStaticMarkup(
      createElement(InspectorPaintRow, {
        children: [
          createElement(
            InspectorGridCell,
            { span: INSPECTOR_GRID_PAINT_FIELD_SPAN, key: "field" },
            "Field",
          ),
          createElement(
            InspectorGridCell,
            { span: INSPECTOR_GRID_PAINT_ACTION_SPAN, key: "visibility" },
            "Visibility",
          ),
          createElement(
            InspectorGridCell,
            { span: INSPECTOR_GRID_PAINT_ACTION_SPAN, key: "remove" },
            "Remove",
          ),
        ],
      }),
    );

    expect(
      INSPECTOR_GRID_PAINT_FIELD_SPAN + INSPECTOR_GRID_PAINT_ACTION_SPAN * 2,
    ).toBe(INSPECTOR_GRID_COLUMNS);
    expect(markup).toContain('data-inspector-layout="paint-row"');
    expect(markup).toContain('data-inspector-action-rail="fixed"');
    expect(markup).toContain('data-inspector-span="20"');
    expect(markup.match(/data-inspector-span="4"/g)).toHaveLength(2);
    expect(INSPECTOR_GRID_PAINT_ACTION_WIDTH_PX).toBe(32);
  });

  it("keeps Stroke geometry inside the paint field and action gutters", () => {
    expect(
      INSPECTOR_GRID_STROKE_POSITION_SPAN +
        INSPECTOR_GRID_STROKE_GUTTER_SPAN +
        INSPECTOR_GRID_STROKE_WEIGHT_SPAN,
    ).toBe(INSPECTOR_GRID_PAINT_FIELD_SPAN);
    expect(
      INSPECTOR_GRID_STROKE_POSITION_SPAN +
        INSPECTOR_GRID_STROKE_GUTTER_SPAN +
        INSPECTOR_GRID_STROKE_WEIGHT_SPAN +
        INSPECTOR_GRID_PAINT_ACTION_SPAN * 2,
    ).toBe(INSPECTOR_GRID_COLUMNS);

    const markup = renderToStaticMarkup(
      createElement(InspectorGrid, {
        layout: "stroke-details",
        children: [
          createElement(InspectorGridCell, { span: 10, key: "position" }),
          createElement(InspectorGridCell, { span: 1, key: "gutter" }),
          createElement(InspectorGridCell, { span: 9, key: "weight" }),
          createElement(InspectorGridCell, { span: 4, key: "settings" }),
          createElement(InspectorGridCell, { span: 4, key: "individual" }),
        ],
      }),
    );

    expect(markup).toContain('data-inspector-layout="stroke-details"');
  });
});

describe("normalizeLengthValue", () => {
  it("appends the default unit to a bare integer", () => {
    expect(normalizeLengthValue("32", "px")).toBe("32px");
  });

  it("appends the default unit to a bare decimal with a leading digit", () => {
    expect(normalizeLengthValue("32.5", "px")).toBe("32.5px");
  });

  it("appends the default unit to a leading-decimal value with no integer part", () => {
    // Regression: "0.5" was accepted but the numerically identical ".5" was
    // rejected (and the field silently reverted instead of committing
    // ".5px") because the old regex required a digit before the dot.
    expect(normalizeLengthValue(".5", "px")).toBe(".5px");
    expect(normalizeLengthValue("-.5", "px")).toBe("-.5px");
  });

  it("passes through a value that already carries a unit", () => {
    expect(normalizeLengthValue("32px", "px")).toBe("32px");
  });

  it("passes through valid CSS keywords", () => {
    expect(normalizeLengthValue("auto", "px")).toBe("auto");
  });

  it("reverts (returns null) for empty input", () => {
    expect(normalizeLengthValue("   ", "px")).toBeNull();
  });

  it("reverts (returns null) for garbage input", () => {
    // This template's vitest environment has no DOM, so `CSS.supports` is
    // normally unavailable and normalizeLengthValue intentionally falls back
    // to accepting the raw value (see its own comment). Stub a minimal
    // CSS.supports so this test exercises the real browser revert path.
    const originalCss = (globalThis as { CSS?: unknown }).CSS;
    (globalThis as { CSS?: unknown }).CSS = { supports: () => false };
    try {
      expect(normalizeLengthValue("abc", "px")).toBeNull();
    } finally {
      (globalThis as { CSS?: unknown }).CSS = originalCss;
    }
  });

  it("accepts the raw value when CSS.supports is unavailable (SSR/test fallback)", () => {
    expect(normalizeLengthValue("abc", "px")).toBe("abc");
  });
});

describe("propInputKeyRequiresBlurGuard", () => {
  it("requires the blur guard for Enter", () => {
    // Regression: Enter previously didn't arm skipNextBlurCommitRef, so the
    // blur triggered by Enter's own `.blur()` call re-ran commit() a second
    // time in the same tick and double-invoked onChange with the identical
    // value.
    expect(propInputKeyRequiresBlurGuard("Enter")).toBe(true);
  });

  it("requires the blur guard for Escape", () => {
    expect(propInputKeyRequiresBlurGuard("Escape")).toBe(true);
  });

  it("does not require the blur guard for any other key", () => {
    expect(propInputKeyRequiresBlurGuard("Tab")).toBe(false);
    expect(propInputKeyRequiresBlurGuard("a")).toBe(false);
    expect(propInputKeyRequiresBlurGuard("ArrowLeft")).toBe(false);
  });
});

describe("resolveSpacingSideValue", () => {
  it("preserves one decimal place instead of flooring to a whole pixel", () => {
    // Regression: DesignSpacingControl's setSide used Math.round, silently
    // discarding the 0.5px precision the four per-side ScrubInput fields
    // advertise via precision={1} (every other ScrubInput commit site in
    // this panel — position X/Y, stroke weight, font size — uses
    // roundToOneDecimal instead of Math.round).
    expect(resolveSpacingSideValue(12.5)).toBe("12.5px");
  });

  it("rounds beyond one decimal place", () => {
    expect(resolveSpacingSideValue(12.34)).toBe("12.3px");
    expect(resolveSpacingSideValue(12.36)).toBe("12.4px");
  });

  it("formats a whole number without a trailing decimal", () => {
    expect(resolveSpacingSideValue(12)).toBe("12px");
  });

  it("never emits a signed-zero pixel value", () => {
    expect(resolveSpacingSideValue(-0.04)).toBe("0px");
  });
});

describe("commitStylePatch", () => {
  it("uses one batch callback and forwards gesture metadata", () => {
    const single = vi.fn();
    const batch = vi.fn();
    const meta = { phase: "commit" as const };

    commitStylePatch(
      { position: "absolute", left: "24px" },
      single,
      batch,
      meta,
    );

    expect(batch).toHaveBeenCalledOnce();
    expect(batch).toHaveBeenCalledWith(
      { position: "absolute", left: "24px" },
      meta,
    );
    expect(single).not.toHaveBeenCalled();
  });
});
