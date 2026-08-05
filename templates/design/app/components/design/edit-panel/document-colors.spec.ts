import { describe, expect, it } from "vitest";

import type { ElementInfo } from "../types";
import { selectionColorValues } from "./document-colors";

function element(overrides: Partial<ElementInfo> = {}): ElementInfo {
  return {
    tagName: "button",
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 0, height: 0 },
    isFlexChild: false,
    isFlexContainer: false,
    childElementCount: 0,
    ...overrides,
  } as ElementInfo;
}

describe("selectionColorValues", () => {
  it("reports the authored token reference, not the colour it resolves to", () => {
    // Selection colors printed a bare hex for a token-backed fill even while
    // the Fill row named it, because it read computedStyles — where the
    // browser has already flattened var().
    const values = selectionColorValues(
      element({
        computedStyles: {
          backgroundColor: "rgb(15, 98, 254)",
          color: "rgb(255, 255, 255)",
        },
        inlineStyles: {
          backgroundColor: "var(--color-accent, #0F62FE)",
          color: "var(--color-background, #FFFFFF)",
        },
      }),
    );

    expect(values).toEqual([
      { property: "color", value: "var(--color-background, #FFFFFF)" },
      { property: "backgroundColor", value: "var(--color-accent, #0F62FE)" },
    ]);
  });

  it("falls back to computed values when nothing is authored inline", () => {
    const values = selectionColorValues(
      element({ computedStyles: { backgroundColor: "rgb(15, 98, 254)" } }),
    );
    expect(values).toEqual([
      { property: "backgroundColor", value: "rgb(15, 98, 254)" },
    ]);
  });

  it("keeps a token reference even though it cannot be parsed as a colour", () => {
    // The zero-alpha filter runs parseCssColor, which returns null for a
    // reference — it must be kept, not dropped as invisible.
    const values = selectionColorValues(
      element({
        computedStyles: { borderColor: "rgb(0, 0, 0)" },
        inlineStyles: { borderColor: "var(--color-text, #161616)" },
      }),
    );
    expect(values).toHaveLength(1);
    expect(values[0].value).toBe("var(--color-text, #161616)");
  });

  it("still drops fully transparent computed colours", () => {
    expect(
      selectionColorValues(
        element({ computedStyles: { backgroundColor: "rgba(0, 0, 0, 0)" } }),
      ),
    ).toEqual([]);
  });
});

describe("selectionColorValues with class-styled colours", () => {
  it("reports the class rule's declaration when nothing is inline", () => {
    const values = selectionColorValues(
      element({
        computedStyles: {
          backgroundColor: "rgb(15, 98, 254)",
          color: "rgb(255, 255, 255)",
        },
        inlineStyles: {},
        authoredColorStyles: {
          backgroundColor: "var(--cds-background-brand)",
          color: "var(--cds-text-on-color)",
        },
      }),
    );

    expect(values).toEqual([
      { property: "color", value: "var(--cds-text-on-color)" },
      { property: "backgroundColor", value: "var(--cds-background-brand)" },
    ]);
  });
});
