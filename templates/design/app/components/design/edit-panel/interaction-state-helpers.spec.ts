import { describe, expect, it } from "vitest";

import type { ElementInfo } from "../types";
import {
  authoredStyleValue,
  resolveInteractionStateValue,
} from "./interaction-state-helpers";

function makeElement(overrides: Partial<ElementInfo> = {}): ElementInfo {
  return {
    tagName: "div",
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 100, height: 40 },
    isFlexChild: false,
    isFlexContainer: false,
    ...overrides,
  };
}

describe("authoredStyleValue", () => {
  it("prefers inlineStyles over computedStyles", () => {
    const element = makeElement({
      computedStyles: { color: "red" },
      inlineStyles: { color: "blue" },
    });
    expect(authoredStyleValue(element, "color")).toBe("blue");
  });

  it("treats an authored 'auto' inline value as unset (empty string)", () => {
    const element = makeElement({ inlineStyles: { left: "auto" } });
    expect(authoredStyleValue(element, "left")).toBe("");
  });

  it("falls back to computedStyles when no inline value exists for the property", () => {
    const element = makeElement({ computedStyles: { top: "12px" } });
    expect(authoredStyleValue(element, "top")).toBe("12px");
  });
});

// ---------------------------------------------------------------------------
// resolveInteractionStateValue — fallback-to-base, precedence, and property
// name normalization (stored state declarations are always kebab-case per
// shared/interaction-states.ts's normalizeCssPropertyName, so this must
// resolve a camelCase caller property to its kebab-case stored key).
// ---------------------------------------------------------------------------

describe("resolveInteractionStateValue", () => {
  it("returns the base value when no state is active (stateStyles undefined)", () => {
    expect(resolveInteractionStateValue(undefined, "color", "black")).toBe(
      "black",
    );
  });

  it("falls back to the base value when the active state has no override for this property", () => {
    const stateStyles = { "background-color": "#111827" };
    expect(resolveInteractionStateValue(stateStyles, "color", "black")).toBe(
      "black",
    );
  });

  it("returns the state's override instead of the base value when one exists (specific state wins over base — not reversed)", () => {
    const stateStyles = { color: "white" };
    expect(resolveInteractionStateValue(stateStyles, "color", "black")).toBe(
      "white",
    );
  });

  it("looks up a camelCase property against the kebab-case stored key", () => {
    const stateStyles = { "background-color": "#111827" };
    expect(
      resolveInteractionStateValue(stateStyles, "backgroundColor", "white"),
    ).toBe("#111827");
  });

  it("looks up a property that is already kebab-case directly", () => {
    const stateStyles = { "background-color": "#111827" };
    expect(
      resolveInteractionStateValue(stateStyles, "background-color", "white"),
    ).toBe("#111827");
  });

  it("treats an explicit empty-string override as a real override, not as missing", () => {
    const stateStyles = { color: "" };
    expect(resolveInteractionStateValue(stateStyles, "color", "black")).toBe(
      "",
    );
  });

  it("does not leak a base-state edit into an existing override, or vice versa (independent objects)", () => {
    const base = { color: "black" };
    const hoverOverride = { ...base, color: "white" };
    // Editing the base object after deriving the hover override must not
    // change the already-resolved hover value (proves no shared reference).
    base.color = "green";
    expect(
      resolveInteractionStateValue(hoverOverride, "color", base.color),
    ).toBe("white");
    // And the reverse: mutating the override object must not retroactively
    // change what the base value was captured as.
    hoverOverride.color = "purple";
    expect(base.color).toBe("green");
  });
});
