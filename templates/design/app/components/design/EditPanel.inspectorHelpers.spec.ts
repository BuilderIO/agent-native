import { describe, expect, it } from "vitest";

import {
  authoredStyleValue,
  isLayerHiddenBySize,
  isTextElement,
  mixedElementFromSelection,
  roundToOneDecimal,
  strokeHiddenByColor,
  withLayerSizeMarker,
} from "./EditPanel";
import type { ElementInfo } from "./types";

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

// ---------------------------------------------------------------------------
// isTextElement — T1: typography panel for T-tool text (div + primitiveKind)
// ---------------------------------------------------------------------------

describe("isTextElement", () => {
  it("treats known text tags as text regardless of primitiveKind", () => {
    expect(isTextElement(makeElement({ tagName: "p" }))).toBe(true);
    expect(isTextElement(makeElement({ tagName: "span" }))).toBe(true);
  });

  it("recognizes a T-tool text primitive (div + primitiveKind=text)", () => {
    expect(
      isTextElement(makeElement({ tagName: "div", primitiveKind: "text" })),
    ).toBe(true);
  });

  it("does not treat a non-text primitive div as text", () => {
    expect(
      isTextElement(
        makeElement({ tagName: "div", primitiveKind: "rectangle" }),
      ),
    ).toBe(false);
  });

  it("does not treat a Mixed primitiveKind as text", () => {
    expect(
      isTextElement(makeElement({ tagName: "div", primitiveKind: "Mixed" })),
    ).toBe(false);
  });

  it("falls back to a content heuristic when primitiveKind is absent (older payloads)", () => {
    expect(
      isTextElement(
        makeElement({
          tagName: "div",
          textContent: "Hello world",
          childElementCount: 0,
        }),
      ),
    ).toBe(true);
  });

  it("does not misclassify an empty container div via the fallback heuristic", () => {
    expect(
      isTextElement(
        makeElement({ tagName: "div", textContent: "", childElementCount: 0 }),
      ),
    ).toBe(false);
  });

  it("does not misclassify a div with element children via the fallback heuristic", () => {
    expect(
      isTextElement(
        makeElement({
          tagName: "div",
          textContent: "wrapper",
          childElementCount: 2,
        }),
      ),
    ).toBe(false);
  });

  it("does not misclassify a flex container div via the fallback heuristic", () => {
    expect(
      isTextElement(
        makeElement({
          tagName: "div",
          textContent: "label",
          childElementCount: 0,
          isFlexContainer: true,
        }),
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// authoredStyleValue — IP3/IP4: prefer inlineStyles, treat "auto" as unset
// ---------------------------------------------------------------------------

describe("authoredStyleValue", () => {
  it("prefers inlineStyles over computedStyles when present", () => {
    const element = makeElement({
      computedStyles: { left: "120px" },
      inlineStyles: { left: "40px" },
    });
    expect(authoredStyleValue(element, "left")).toBe("40px");
  });

  it("treats an authored 'auto' inline value as unset (empty string)", () => {
    const element = makeElement({
      computedStyles: { left: "120px" },
      inlineStyles: { left: "auto" },
    });
    expect(authoredStyleValue(element, "left")).toBe("");
  });

  it("falls back to computedStyles when inlineStyles is absent (older payload)", () => {
    const element = makeElement({ computedStyles: { left: "77px" } });
    expect(authoredStyleValue(element, "left")).toBe("77px");
  });

  it("falls back to computedStyles when the specific inline property is absent", () => {
    const element = makeElement({
      computedStyles: { top: "12px" },
      inlineStyles: { left: "5px" },
    });
    expect(authoredStyleValue(element, "top")).toBe("12px");
  });
});

// ---------------------------------------------------------------------------
// isLayerHiddenBySize / withLayerSizeMarker — IP6/IP7: durable, comment-free
// non-destructive hide for background layers
// ---------------------------------------------------------------------------

describe("isLayerHiddenBySize / withLayerSizeMarker", () => {
  it("detects the zero-size marker", () => {
    expect(isLayerHiddenBySize("0px 0px")).toBe(true);
  });

  it("tolerates extra whitespace in the marker", () => {
    expect(isLayerHiddenBySize("0px   0px")).toBe(true);
  });

  it("does not flag a real auto/cover size as hidden", () => {
    expect(isLayerHiddenBySize("auto")).toBe(false);
    expect(isLayerHiddenBySize("cover")).toBe(false);
    expect(isLayerHiddenBySize(undefined)).toBe(false);
  });

  it("hides only the target layer, padding others with auto", () => {
    const result = withLayerSizeMarker(["cover"], 2, 1, true);
    expect(result).toBe("cover, 0px 0px");
  });

  it("shows a layer back by writing auto at its index", () => {
    const result = withLayerSizeMarker(["auto", "0px 0px"], 2, 1, false);
    expect(result).toBe("auto, auto");
  });

  it("round-trips: hide then show restores auto without touching other layers", () => {
    const hidden = withLayerSizeMarker(["contain"], 2, 1, true);
    expect(hidden).toBe("contain, 0px 0px");
    const shown = withLayerSizeMarker(["contain", "0px 0px"], 2, 1, false);
    expect(shown).toBe("contain, auto");
  });
});

// ---------------------------------------------------------------------------
// strokeHiddenByColor — IP11: hide stroke via zero-alpha color (preserves style)
// ---------------------------------------------------------------------------

describe("strokeHiddenByColor", () => {
  it("is true for a zero-alpha rgba color with real RGB preserved", () => {
    expect(strokeHiddenByColor("rgba(37, 99, 235, 0)")).toBe(true);
  });

  it("is false for an opaque color", () => {
    expect(strokeHiddenByColor("rgb(37, 99, 235)")).toBe(false);
    expect(strokeHiddenByColor("#000000")).toBe(false);
  });

  it("is false for an empty/absent color", () => {
    expect(strokeHiddenByColor(undefined)).toBe(false);
    expect(strokeHiddenByColor("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// roundToOneDecimal — IP11/T18: precision=1 controls shouldn't floor to ints
// ---------------------------------------------------------------------------

describe("roundToOneDecimal", () => {
  it("preserves a 0.5 fractional value", () => {
    expect(roundToOneDecimal(1.5)).toBe(1.5);
  });

  it("rounds beyond one decimal", () => {
    expect(roundToOneDecimal(1.449)).toBe(1.4);
    expect(roundToOneDecimal(1.46)).toBe(1.5);
  });

  it("leaves whole numbers unchanged", () => {
    expect(roundToOneDecimal(4)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// mixedElementFromSelection — inlineStyles/primitiveKind mixing for multi-select
// ---------------------------------------------------------------------------

describe("mixedElementFromSelection", () => {
  it("mixes inlineStyles across the selection like computedStyles", () => {
    const a = makeElement({ inlineStyles: { left: "10px" } });
    const b = makeElement({ inlineStyles: { left: "20px" } });
    const merged = mixedElementFromSelection([a, b]);
    expect(merged?.inlineStyles?.left).toBe("Mixed");
  });

  it("keeps a shared inlineStyles value when all elements agree", () => {
    const a = makeElement({ inlineStyles: { position: "absolute" } });
    const b = makeElement({ inlineStyles: { position: "absolute" } });
    const merged = mixedElementFromSelection([a, b]);
    expect(merged?.inlineStyles?.position).toBe("absolute");
  });

  it("mixes primitiveKind so a text+shape selection isn't misread as text", () => {
    const a = makeElement({ tagName: "div", primitiveKind: "text" });
    const b = makeElement({ tagName: "div", primitiveKind: "rectangle" });
    const merged = mixedElementFromSelection([a, b]);
    expect(merged?.primitiveKind).toBe("Mixed");
    expect(merged).not.toBeNull();
    expect(isTextElement(merged!)).toBe(false);
  });

  it("keeps a shared primitiveKind when the whole selection is text", () => {
    const a = makeElement({ tagName: "div", primitiveKind: "text" });
    const b = makeElement({ tagName: "div", primitiveKind: "text" });
    const merged = mixedElementFromSelection([a, b]);
    expect(merged?.primitiveKind).toBe("text");
  });
});
