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
});
