import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AutoLayoutMatrix,
  type AutoLayoutMatrixValue,
} from "./AutoLayoutMatrix";

const value: AutoLayoutMatrixValue = {
  direction: "horizontal",
  wrap: "nowrap",
  alignment: { horizontal: "left", vertical: "top" },
  gap: 8,
  padding: { top: 4, right: 4, bottom: 4, left: 4 },
  paddingLinked: true,
  childSizing: { horizontal: "fixed", vertical: "fixed" },
  clipContent: false,
  display: "flex",
};

const noop = () => {};

describe("AutoLayoutMatrix", () => {
  it("hides child layout controls when the selection has no children", () => {
    const markup = renderToStaticMarkup(
      createElement(AutoLayoutMatrix, {
        value,
        showChildLayoutControls: false,
        onDirectionChange: noop,
        onWrapChange: noop,
        onAlignmentChange: noop,
        onGapChange: noop,
        onPaddingChange: noop,
        onPaddingLinkedChange: noop,
        onChildSizingChange: noop,
      }),
    );

    expect(markup).toContain("Resizing");
    expect(markup).not.toContain("Flow");
    expect(markup).not.toContain("Alignment");
    expect(markup).not.toContain("Gap");
    expect(markup).not.toContain("Padding");
    expect(markup).not.toContain("Clip content");
  });

  it("shows a Mixed placeholder for gap instead of a misleading 0 when the multi-selection's gap values differ", () => {
    const markup = renderToStaticMarkup(
      createElement(AutoLayoutMatrix, {
        value: { ...value, gap: 0, gapMixed: true },
        onDirectionChange: noop,
        onWrapChange: noop,
        onAlignmentChange: noop,
        onGapChange: noop,
        onPaddingChange: noop,
        onPaddingLinkedChange: noop,
        onChildSizingChange: noop,
      }),
    );

    expect(markup).toContain("Mixed");
    expect(markup).not.toMatch(/value="0"/);
  });

  it("shows a Mixed placeholder for the linked horizontal padding field when left/right differ across the selection, without marking the vertical field mixed", () => {
    const markup = renderToStaticMarkup(
      createElement(AutoLayoutMatrix, {
        value: {
          ...value,
          padding: { top: 4, right: 0, bottom: 4, left: 0 },
          paddingMixed: { left: true, right: true },
        },
        onDirectionChange: noop,
        onWrapChange: noop,
        onAlignmentChange: noop,
        onGapChange: noop,
        onPaddingChange: noop,
        onPaddingLinkedChange: noop,
        onChildSizingChange: noop,
      }),
    );

    // Both the horizontal padding field's aria-label and the literal "Mixed"
    // placeholder text should be present.
    expect(markup).toContain("Mixed");
  });

  it("shows Mixed for a single unlinked padding side without affecting the other sides", () => {
    const markup = renderToStaticMarkup(
      createElement(AutoLayoutMatrix, {
        value: {
          ...value,
          padding: { top: 4, right: 4, bottom: 4, left: 8 },
          paddingLinked: false,
          paddingMixed: { left: true },
        },
        onDirectionChange: noop,
        onWrapChange: noop,
        onAlignmentChange: noop,
        onGapChange: noop,
        onPaddingChange: noop,
        onPaddingLinkedChange: noop,
        onChildSizingChange: noop,
      }),
    );

    expect(markup).toContain("Mixed");
  });

  it("shows an explicit Mixed flow with no plausible segment selected", () => {
    const markup = renderToStaticMarkup(
      createElement(AutoLayoutMatrix, {
        value: { ...value, flowMixed: true },
        onDirectionChange: noop,
        onWrapChange: noop,
        onAlignmentChange: noop,
        onGapChange: noop,
        onPaddingChange: noop,
        onPaddingLinkedChange: noop,
        onChildSizingChange: noop,
      }),
    );

    expect(markup).toContain('data-flow-value="mixed"');
    expect(markup).toContain("Mixed");
    expect(markup).toContain('aria-label="Normal flow" aria-pressed="false"');
    expect(markup).toContain('aria-label="Vertical" aria-pressed="false"');
    expect(markup).toContain('aria-label="Horizontal" aria-pressed="false"');
    expect(markup).toContain('aria-label="Grid" aria-pressed="false"');
  });

  it("shows mixed alignment, gap mode, and clipping without plausible defaults", () => {
    const markup = renderToStaticMarkup(
      createElement(AutoLayoutMatrix, {
        value: {
          ...value,
          alignmentMixed: true,
          gapModeMixed: true,
          clipContentMixed: true,
        },
        onDirectionChange: noop,
        onWrapChange: noop,
        onAlignmentChange: noop,
        onGapChange: noop,
        onPaddingChange: noop,
        onPaddingLinkedChange: noop,
        onChildSizingChange: noop,
        onDistribute: noop,
      }),
    );

    expect(markup).toContain("Gap mode: Mixed");
    expect(markup).toContain('aria-checked="mixed"');
    for (const label of [
      "top left",
      "top center",
      "top right",
      "middle left",
      "middle center",
      "middle right",
      "bottom left",
      "bottom center",
      "bottom right",
    ]) {
      expect(markup).toContain(`aria-label="${label}" aria-pressed="false"`);
    }
  });
});
