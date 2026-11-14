import { describe, expect, it } from "vitest";

import { propertiesOverlap } from "./email-css-properties.js";

describe("email CSS property coverage", () => {
  it.each([
    ["padding", "padding-left"],
    ["margin", "margin-bottom"],
    ["inset", "left"],
    ["padding", "padding-inline-start"],
    ["margin-inline", "margin-left"],
    ["inset-block", "top"],
    ["border", "border-left-width"],
    ["border-left", "border-left-color"],
    ["border-width", "border-top"],
    ["border", "border-image"],
    ["border", "border-image-outset"],
    ["border-image", "border-image-slice"],
    ["border-radius", "border-bottom-right-radius"],
    ["border-radius", "border-start-start-radius"],
    ["border-inline", "border-left-color"],
    ["border-block-width", "border-top-width"],
    ["background", "background-color"],
    ["background", "background-position-x"],
    ["background-position", "background-position-y"],
    ["background-repeat", "background-repeat-x"],
    ["outline", "outline-style"],
    ["list-style", "list-style-position"],
    ["text-decoration", "text-decoration-thickness"],
    ["overflow", "overflow-y"],
    ["overflow", "overflow-inline"],
    ["columns", "column-count"],
    ["columns", "column-height"],
    ["column-rule", "column-rule-color"],
    ["  PADDING ", "padding-top"],
    ["p\\61 dding", "padding-left"],
    ["color", "COLOR"],
    ["--brand", "--brand"],
    ["unrecognized-property", "unrecognized-property"],
  ])("detects overlap between %s and %s in either order", (first, second) => {
    expect(propertiesOverlap(first, second)).toBe(true);
    expect(propertiesOverlap(second, first)).toBe(true);
  });

  it.each([
    ["padding-left", "padding-right"],
    ["margin", "padding"],
    ["padding-inline", "padding-block"],
    ["padding-inline-start", "padding-inline-end"],
    ["border-top-color", "border-left-color"],
    ["border-width", "border-color"],
    ["border-top", "border-bottom"],
    ["border", "border-radius"],
    ["border-top", "border-image"],
    ["border-radius", "border-width"],
    ["border-start-start-radius", "border-start-end-radius"],
    ["background", "background-blend-mode"],
    ["background-color", "background-image"],
    ["background-position-x", "background-position-y"],
    ["outline", "outline-offset"],
    ["list-style-image", "list-style-type"],
    ["text-decoration", "text-decoration-skip-ink"],
    ["overflow-x", "overflow-y"],
    ["overflow-inline", "overflow-block"],
    ["columns", "column-gap"],
    ["column-width", "column-count"],
    ["--brand", "--Brand"],
    ["unrecognized-property", "unrecognized-property-part"],
  ])("keeps unrelated properties %s and %s separate", (first, second) => {
    expect(propertiesOverlap(first, second)).toBe(false);
    expect(propertiesOverlap(second, first)).toBe(false);
  });
});
