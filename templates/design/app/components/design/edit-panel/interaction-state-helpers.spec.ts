import { describe, expect, it } from "vitest";

import type { ElementInfo } from "../types";
import { cssElementSize } from "./element-classification";
import {
  clearAuthoredSizeStylesForCommit,
  patchAuthoredInlineStyles,
  authoredStyleValue,
  elementWithInteractionStateStyles,
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

  it("keeps authored line-height units ahead of computed pixel values", () => {
    const element = makeElement({
      computedStyles: { lineHeight: "24px" },
      inlineStyles: { lineHeight: "30%" },
    });
    expect(authoredStyleValue(element, "lineHeight")).toBe("30%");
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
    base.color = "green";
    expect(
      resolveInteractionStateValue(hoverOverride, "color", base.color),
    ).toBe("white");
    hoverOverride.color = "purple";
    expect(base.color).toBe("green");
  });
});

describe("elementWithInteractionStateStyles", () => {
  it("projects kebab-case state values into both authored and computed inspector reads", () => {
    const base = makeElement({
      computedStyles: { backgroundColor: "white", opacity: "1" },
      inlineStyles: { backgroundColor: "white" },
    });
    const projected = elementWithInteractionStateStyles(base, {
      "background-color": "black",
      opacity: "0.7",
    });

    expect(authoredStyleValue(projected, "backgroundColor")).toBe("black");
    expect(projected.computedStyles.backgroundColor).toBe("black");
    expect(projected.inlineStyles?.opacity).toBe("0.7");
  });

  it("feeds representative geometry, fill, stroke, effect, and typography controls", () => {
    const base = makeElement({
      boundingRect: { x: 10, y: 20, width: 100, height: 40 },
      computedStyles: {
        width: "100px",
        height: "40px",
        left: "10px",
        top: "20px",
        backgroundColor: "white",
        borderColor: "black",
        boxShadow: "none",
        fontSize: "14px",
      },
      inlineStyles: { left: "10px", top: "20px" },
    });
    const projected = elementWithInteractionStateStyles(base, {
      width: "240px",
      height: "64px",
      left: "32px",
      top: "48px",
      "background-color": "red",
      "border-color": "blue",
      "box-shadow": "0 4px 8px rgb(0 0 0 / 0.2)",
      "font-size": "18px",
    });

    expect(cssElementSize(projected, "horizontal")).toBe(240);
    expect(cssElementSize(projected, "vertical")).toBe(64);
    expect(authoredStyleValue(projected, "left")).toBe("32px");
    expect(authoredStyleValue(projected, "top")).toBe("48px");
    expect(projected.computedStyles.backgroundColor).toBe("red");
    expect(projected.computedStyles.borderColor).toBe("blue");
    expect(projected.computedStyles.boxShadow).toContain("0 4px 8px");
    expect(projected.computedStyles.fontSize).toBe("18px");
    expect(projected.boundingRect).toEqual(base.boundingRect);
  });

  it("falls back to untouched base values for properties without a state override", () => {
    const base = makeElement({
      computedStyles: { color: "blue", opacity: "1" },
    });
    const projected = elementWithInteractionStateStyles(base, {
      opacity: "0.5",
    });
    expect(projected.computedStyles.color).toBe("blue");
    expect(projected.computedStyles.opacity).toBe("0.5");
  });

  it("returns the original object for Default/no override state", () => {
    const base = makeElement({ computedStyles: { color: "blue" } });
    expect(elementWithInteractionStateStyles(base, undefined)).toBe(base);
    expect(elementWithInteractionStateStyles(base, {})).toBe(base);
  });
});

describe("patchAuthoredInlineStyles", () => {
  it("carries a committed authored size onto the snapshot", () => {
    expect(
      patchAuthoredInlineStyles(
        { width: "180px" },
        { width: "fit-content", flexGrow: "0" },
      ),
    ).toEqual({ width: "fit-content" });
  });

  it("leaves an absent snapshot absent — absence is meaningful downstream", () => {
    expect(
      patchAuthoredInlineStyles(undefined, { width: "fit-content" }),
    ).toBeUndefined();
  });

  it("carries supported color while ignoring properties outside the snapshot", () => {
    expect(
      patchAuthoredInlineStyles({}, { color: "red", fontWeight: "700" }),
    ).toEqual({ color: "red" });
  });

  it("keeps unrelated authored values", () => {
    expect(
      patchAuthoredInlineStyles(
        { position: "absolute", left: "10px" },
        { height: "fit-content" },
      ),
    ).toEqual({
      position: "absolute",
      left: "10px",
      height: "fit-content",
    });
  });
  it("carries committed alignment and shorthand authoring onto the snapshot", () => {
    const committed = {
      alignItems: "center",
      alignContent: "space-between",
      justifyItems: "start",
      gap: "16px",
      padding: "12px",
    };
    expect(
      patchAuthoredInlineStyles({ alignItems: "flex-start" }, committed),
    ).toEqual(committed);
  });

  it("carries committed flex, gap and padding authoring onto the snapshot", () => {
    const committed = {
      flexDirection: "column",
      flexWrap: "wrap",
      columnGap: "12px",
      rowGap: "8px",
      justifyContent: "space-between",
      paddingTop: "4px",
      paddingRight: "6px",
      paddingBottom: "10px",
      paddingLeft: "2px",
    };
    expect(
      patchAuthoredInlineStyles(
        { flexDirection: "row", paddingTop: "0px" },
        committed,
      ),
    ).toEqual(committed);
  });
});

describe("clearAuthoredSizeStylesForCommit", () => {
  it("drops changed native hints while retaining unrelated axes", () => {
    expect(
      clearAuthoredSizeStylesForCommit(
        { width: "240px", height: "auto" },
        { width: "fit-content" },
      ),
    ).toEqual({ height: "auto" });
  });

  it("preserves absence when the snapshot has no native hints", () => {
    expect(
      clearAuthoredSizeStylesForCommit(undefined, { width: "120px" }),
    ).toBe(undefined);
  });
});
