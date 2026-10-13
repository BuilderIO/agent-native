import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AutoLayoutMatrix,
  mirrorPaddingChange,
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
  it("mirrors the opposite padding side only for an Alt scrub", () => {
    const padding = { top: 4, right: 8, bottom: 12, left: 16 };

    expect(
      mirrorPaddingChange({ ...padding, top: 24 }, "top", {
        source: "scrub",
        phase: "preview",
        altKey: true,
      }),
    ).toEqual({
      top: 24,
      right: 8,
      bottom: 24,
      left: 16,
    });
    expect(mirrorPaddingChange({ ...padding, top: 24 }, "top")).toEqual({
      top: 24,
      right: 8,
      bottom: 12,
      left: 16,
    });
  });

  it("renders fractional resolved sizes without rounding them away", () => {
    const markup = renderToStaticMarkup(
      createElement(AutoLayoutMatrix, {
        value: {
          ...value,
          resolvedSize: { horizontal: 123.4, vertical: 45.6 },
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

    expect(markup).toContain("W 123.4 Fixed");
    expect(markup).toContain("H 45.6 Fixed");
  });

  it("keeps gap and unlinked padding on fixed inspector grid geometry", () => {
    const markup = renderToStaticMarkup(
      createElement(AutoLayoutMatrix, {
        value,
        onDirectionChange: noop,
        onWrapChange: noop,
        onAlignmentChange: noop,
        onGapChange: noop,
        onPaddingChange: noop,
        onPaddingLinkedChange: noop,
        onChildSizingChange: noop,
      }),
    );

    expect(markup).toMatch(
      /data-inspector-layout="pair-flow"[^>]*>[\s\S]*?data-inspector-span="13"[\s\S]*?data-inspector-span="13"/,
    );
    expect(markup).toMatch(
      /<input(?=[^>]*aria-label="Gap")(?=[^>]*class="[^"]*h-6[^"]*")[^>]*>/,
    );

    const unlinkedMarkup = renderToStaticMarkup(
      createElement(AutoLayoutMatrix, {
        value: { ...value, paddingLinked: false },
        onDirectionChange: noop,
        onWrapChange: noop,
        onAlignmentChange: noop,
        onGapChange: noop,
        onPaddingChange: noop,
        onPaddingLinkedChange: noop,
        onChildSizingChange: noop,
      }),
    );
    expect(unlinkedMarkup).toMatch(
      /data-inspector-layout="pair"[^>]*>[\s\S]*?data-inspector-span="11"[\s\S]*?data-inspector-span="2"[\s\S]*?data-inspector-span="11"[\s\S]*?data-inspector-span="11"[\s\S]*?data-inspector-span="2"[\s\S]*?data-inspector-span="11"/,
    );
  });

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

  it("does not offer resize to fit for an unmeasurable shape", () => {
    const markup = renderToStaticMarkup(
      createElement(AutoLayoutMatrix, {
        value,
        availableChildSizing: {
          horizontal: ["fixed"],
          vertical: ["fixed"],
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

    expect(markup).not.toContain("Resize to fit");
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

  it("keeps the flex alignment and gap row on the canonical pair geometry", () => {
    const markup = renderToStaticMarkup(
      createElement(AutoLayoutMatrix, {
        value,
        onDirectionChange: noop,
        onWrapChange: noop,
        onAlignmentChange: noop,
        onGapChange: noop,
        onPaddingChange: noop,
        onPaddingLinkedChange: noop,
        onChildSizingChange: noop,
      }),
    );

    expect(markup).toContain('data-inspector-layout="pair-flow"');
    expect(markup.match(/data-inspector-span="13"/g)).toHaveLength(2);
    expect(markup).not.toContain('data-inspector-span="14"');
    expect(markup).toContain("w-full max-w-[92px]");
  });
});
