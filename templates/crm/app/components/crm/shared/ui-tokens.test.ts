import { describe, expect, it } from "vitest";

import { overlayProps, selectionCornerRadius } from "./ui-tokens";

describe("overlayProps", () => {
  it("omits the state attribute when not selected", () => {
    const props = overlayProps();
    expect(props.className).toBe("crm-overlay");
    expect(props["data-selected"]).toBeUndefined();
  });

  it("marks selection and merges caller classes", () => {
    const props = overlayProps({ selected: true, className: "flex h-9" });
    expect(props["data-selected"]).toBe("true");
    expect(props.className).toContain("crm-overlay");
    expect(props.className).toContain("flex");
  });

  it("opts cells into the soft selection tint", () => {
    expect(overlayProps({ soft: true }).className).toContain(
      "crm-overlay-soft",
    );
  });
});

describe("selectionCornerRadius", () => {
  it("rounds a single cell on all four corners", () => {
    const radius = selectionCornerRadius({
      top: true,
      right: true,
      bottom: true,
      left: true,
    });
    expect(radius).toBe("4px 4px 4px 4px");
  });

  it("rounds only where both border segments exist", () => {
    // Top-left cell of a range: outer corner rounds, inner corners stay square.
    expect(
      selectionCornerRadius({
        top: true,
        right: false,
        bottom: false,
        left: true,
      }),
    ).toBe("4px 0 0 0");
  });

  it("leaves an interior cell fully square", () => {
    expect(
      selectionCornerRadius({
        top: false,
        right: false,
        bottom: false,
        left: false,
      }),
    ).toBe("0 0 0 0");
  });
});
