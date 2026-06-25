import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BlockRenderContext, NestedBlock } from "../types.js";
import type { ColumnsData } from "./columns.config.js";
import { ColumnsBlockReader } from "./columns.js";

/**
 * Rendering contract for the `columns` comparison block:
 *   1. A column's `label` renders as an `<h4 class="plan-columns-label">` ABOVE
 *      that column, so a before/after comparison names its states outside the
 *      content instead of baking the label into a child wireframe.
 *   2. The layout is picked from the child wireframe surface: narrow surfaces
 *      stay side by side (`md:grid-cols-2`); wide `desktop`/`browser` frames
 *      stack vertically (`grid-cols-1`, never `md:grid-cols-2`) so a large frame
 *      is never crushed into a half-width column.
 */

const stubCtx = {
  renderBlock: ({ block }: { block: NestedBlock }) =>
    createElement("div", { "data-child": block.id }),
} as unknown as BlockRenderContext;

function wireframeChild(id: string, surface: string): NestedBlock {
  return { id, type: "wireframe", data: { surface, html: "<div></div>" } };
}

function render(data: ColumnsData): string {
  return renderToStaticMarkup(
    createElement(ColumnsBlockReader, {
      data,
      blockId: "cols",
      ctx: stubCtx,
    }),
  );
}

describe("columns block rendering", () => {
  it("renders each column label as an h4 above the column content", () => {
    const html = render({
      columns: [
        { id: "b", label: "Before", blocks: [wireframeChild("w1", "popover")] },
        { id: "a", label: "After", blocks: [wireframeChild("w2", "popover")] },
      ],
    });

    expect(html).toContain('<h4 class="plan-columns-label">Before</h4>');
    expect(html).toContain('<h4 class="plan-columns-label">After</h4>');
    // The label sits BEFORE its column's child in document order (above it).
    expect(html.indexOf("Before")).toBeLessThan(
      html.indexOf('data-child="w1"'),
    );
  });

  it("keeps narrow-surface comparisons side by side", () => {
    const html = render({
      columns: [
        { id: "b", label: "Before", blocks: [wireframeChild("w1", "popover")] },
        { id: "a", label: "After", blocks: [wireframeChild("w2", "panel")] },
      ],
    });

    expect(html).toContain("md:grid-cols-2");
  });

  it("stacks wide desktop/browser comparisons vertically", () => {
    const html = render({
      columns: [
        { id: "b", label: "Before", blocks: [wireframeChild("w1", "desktop")] },
        { id: "a", label: "After", blocks: [wireframeChild("w2", "desktop")] },
      ],
    });

    expect(html).toContain("grid-cols-1");
    expect(html).not.toContain("md:grid-cols-2");
  });

  it("does not render a header for unlabeled columns", () => {
    const html = render({
      columns: [
        { id: "x", blocks: [wireframeChild("w1", "popover")] },
        { id: "y", blocks: [wireframeChild("w2", "popover")] },
      ],
    });

    expect(html).not.toContain("plan-columns-label");
  });
});
