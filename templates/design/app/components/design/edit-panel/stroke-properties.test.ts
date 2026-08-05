import { describe, expect, it } from "vitest";

import type { ElementInfo } from "../types";
import { authoredStrokeColor } from "./stroke-properties";

function element(overrides: Partial<ElementInfo> = {}): ElementInfo {
  return {
    tagName: "div",
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 0, height: 0 },
    isFlexChild: false,
    isFlexContainer: false,
    childElementCount: 0,
    ...overrides,
  } as ElementInfo;
}

describe("authoredStrokeColor", () => {
  it("names a stroke authored as a token reference in a class rule", () => {
    expect(
      authoredStrokeColor(
        element({
          computedStyles: { borderColor: "rgb(224, 224, 224)" },
          authoredColorStyles: { borderColor: "var(--cds-border-subtle-00)" },
        }),
        "borderColor",
        "rgb(224, 224, 224)",
      ),
    ).toBe("var(--cds-border-subtle-00)");
  });

  it("prefers an inline reference over the class rule", () => {
    expect(
      authoredStrokeColor(
        element({
          computedStyles: { borderColor: "rgb(224, 224, 224)" },
          inlineStyles: { borderColor: "var(--color-accent, #0f62fe)" },
          authoredColorStyles: { borderColor: "var(--cds-border-subtle-00)" },
        }),
        "borderColor",
        "rgb(224, 224, 224)",
      ),
    ).toBe("var(--color-accent, #0f62fe)");
  });

  it("keeps the computed colour when the stroke is a plain literal", () => {
    // A Tailwind utility border is a colour, not a token, and must not be named.
    expect(
      authoredStrokeColor(
        element({
          computedStyles: { borderColor: "rgb(229, 231, 235)" },
          authoredColorStyles: {
            borderColor: "rgb(229 231 235 / var(--tw-border-opacity))",
          },
        }),
        "borderColor",
        "rgb(229, 231, 235)",
      ),
    ).toBe("rgb(229, 231, 235)");
  });

  it("reads as unset when no rule set the stroke colour", () => {
    // The border then paints `currentColor`; echoing the inherited text colour
    // would claim a stroke colour the design never chose.
    expect(
      authoredStrokeColor(
        element({ computedStyles: { borderColor: "rgb(22, 22, 22)" } }),
        "borderColor",
        "rgb(22, 22, 22)",
      ),
    ).toBe("");
  });

  it("keeps the authored colour when the element reports no computed value", () => {
    expect(
      authoredStrokeColor(
        element({ authoredColorStyles: { outlineColor: "#0f62fe" } }),
        "outlineColor",
        undefined,
      ),
    ).toBe("#0f62fe");
  });
});
