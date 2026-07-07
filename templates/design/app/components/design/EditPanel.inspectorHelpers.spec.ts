import { describe, expect, it } from "vitest";

import {
  authoredStyleValue,
  deriveLockedAspectSize,
  fourValuesEqual,
  isLayerHiddenBySize,
  isTextElement,
  mixedElementFromSelection,
  outlineOffsetForPosition,
  readStrokeOutlinePosition,
  readTextStrokeStyle,
  resolveTextStrokeColor,
  roundToOneDecimal,
  strokeHiddenByColor,
  textStrokeIsVisible,
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

  it("classifies a childless flex div with its own text as text (B5-12)", () => {
    // REVERSED from the original assertion: this test used to require the
    // fallback to reject flex containers, but real-design evidence proved
    // that assumption wrong — the T-tool's own text primitives are
    // `display: flex` divs (flex drives their vertical alignment), and
    // board/overview selection payloads omit `primitiveKind`, so the old
    // exclusion made the Typography section vanish for exactly those text
    // nodes (text nested in a rectangle via nest-on-drop). A childless div
    // with its own text is text, flex or not; real containers are still
    // rejected by the childElementCount guard above.
    expect(
      isTextElement(
        makeElement({
          tagName: "div",
          textContent: "label",
          childElementCount: 0,
          isFlexContainer: true,
        }),
      ),
    ).toBe(true);
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
// textStrokeIsVisible / resolveTextStrokeColor — R94: text "Stroke" is a real
// glyph outline (-webkit-text-stroke), independent of fill (`color`).
// Removing the fill must never hide the glyphs when a stroke exists, and the
// stroke color must never fall back to the (possibly transparent) fill color.
// ---------------------------------------------------------------------------

describe("textStrokeIsVisible", () => {
  it("is true for a non-zero width with an opaque color", () => {
    expect(textStrokeIsVisible("2px", "#000000")).toBe(true);
    expect(textStrokeIsVisible("2px", "rgb(37, 99, 235)")).toBe(true);
  });

  it("is false when width is zero, regardless of color", () => {
    expect(textStrokeIsVisible("0px", "#000000")).toBe(false);
    expect(textStrokeIsVisible(undefined, "#000000")).toBe(false);
  });

  it("is false when the color is zero-alpha, even with a real width", () => {
    expect(textStrokeIsVisible("2px", "rgba(0, 0, 0, 0)")).toBe(false);
  });

  it("is false when both width and color are absent", () => {
    expect(textStrokeIsVisible(undefined, undefined)).toBe(false);
  });
});

describe("resolveTextStrokeColor", () => {
  it("returns the stroke color unchanged when it is opaque", () => {
    expect(resolveTextStrokeColor("rgb(37, 99, 235)")).toBe("rgb(37, 99, 235)");
    expect(resolveTextStrokeColor("#ff0000")).toBe("#ff0000");
  });

  it("falls back to opaque black when the stroke color is absent", () => {
    expect(resolveTextStrokeColor(undefined)).toBe("#000000");
    expect(resolveTextStrokeColor("")).toBe("#000000");
  });

  it("falls back to opaque black when the stroke color is transparent", () => {
    expect(resolveTextStrokeColor("transparent")).toBe("#000000");
    expect(resolveTextStrokeColor("rgba(0, 0, 0, 0)")).toBe("#000000");
  });

  it("never derives from a separate (removed) fill color — only reads its own argument", () => {
    // Regression guard for the R94 bug: StrokeProperties previously fell back
    // to `styles.color` (the text fill) via `styles.borderColor || styles.color`.
    // resolveTextStrokeColor must have no such fallback — a caller that
    // (incorrectly) passed the fill color here would just get it back
    // unchanged, proving the function itself never reaches for fill state.
    expect(resolveTextStrokeColor("rgba(0, 0, 0, 0)")).not.toBe(
      "rgba(0, 0, 0, 0)",
    );
  });
});

// ---------------------------------------------------------------------------
// readTextStrokeStyle — R94: a text stroke must read back correctly from
// BOTH computedStyles shapes EditPanel ever receives:
//   1. A live DOM selection (editor-chrome.bridge.ts) reports the two
//      longhands directly: webkitTextStrokeWidth / webkitTextStrokeColor.
//   2. A projection-only selection (elementInfoFromCodeLayerNode in
//      DesignEditor.tsx, used right after reload/reselect before a live
//      bridge re-selection) instead carries whatever was literally
//      serialized into the inline style attribute — which browsers always
//      write back as the shorthand `-webkit-text-stroke: <width> <color>`,
//      never as the two longhands individually.
// Without the shorthand fallback here, the Stroke section would go blank on
// reload for a stroke that is fully persisted and rendering.
// ---------------------------------------------------------------------------

describe("readTextStrokeStyle", () => {
  it("reads the longhand keys when present (live DOM selection shape)", () => {
    expect(
      readTextStrokeStyle({
        webkitTextStrokeWidth: "2px",
        webkitTextStrokeColor: "rgb(37, 99, 235)",
      }),
    ).toEqual({ width: "2px", color: "rgb(37, 99, 235)" });
  });

  it("falls back to parsing the dash-cased shorthand (projection shape)", () => {
    expect(
      readTextStrokeStyle({ "-webkit-text-stroke": "1px rgb(0, 0, 0)" }),
    ).toEqual({ width: "1px", color: "rgb(0, 0, 0)" });
  });

  it("falls back to parsing the camelCase-aliased shorthand (DesignEditor's cssStyleAliases form)", () => {
    expect(readTextStrokeStyle({ WebkitTextStroke: "3px #ff0000" })).toEqual({
      width: "3px",
      color: "#ff0000",
    });
  });

  it("handles a shorthand with color-then-width order", () => {
    expect(
      readTextStrokeStyle({ "-webkit-text-stroke": "rgb(0, 0, 0) 2px" }),
    ).toEqual({ width: "2px", color: "rgb(0, 0, 0)" });
  });

  it("prefers the longhands over the shorthand when both are somehow present", () => {
    expect(
      readTextStrokeStyle({
        webkitTextStrokeWidth: "5px",
        webkitTextStrokeColor: "#00ff00",
        "-webkit-text-stroke": "1px rgb(0, 0, 0)",
      }),
    ).toEqual({ width: "5px", color: "#00ff00" });
  });

  it("returns zero width and empty color when no stroke data is present at all", () => {
    expect(readTextStrokeStyle({})).toEqual({ width: "0px", color: "" });
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
// readStrokeOutlinePosition / outlineOffsetForPosition — Figma-parity center
// stroke: implemented as CSS outline + a negative outline-offset of half the
// stroke width, distinguished from "outside" (offset 0) by reading the
// offset back relative to the current width.
// ---------------------------------------------------------------------------

describe("readStrokeOutlinePosition", () => {
  it("reads offset 0 (or unset) as outside", () => {
    expect(readStrokeOutlinePosition("4px", "0px")).toBe("outside");
    expect(readStrokeOutlinePosition("4px", undefined)).toBe("outside");
  });

  it("reads a negative half-width offset as center", () => {
    expect(readStrokeOutlinePosition("4px", "-2px")).toBe("center");
  });

  it("reads a positive offset as outside (never negative-only for center)", () => {
    expect(readStrokeOutlinePosition("4px", "4px")).toBe("outside");
  });

  it("tolerates float drift from an odd width (e.g. 3px -> -1.5px)", () => {
    expect(readStrokeOutlinePosition("3px", "-1.5px")).toBe("center");
  });

  it("does not misread a small non-centered negative offset as center", () => {
    // width 10 -> center would be -5; -1 is much closer to "outside" intent.
    expect(readStrokeOutlinePosition("10px", "-1px")).toBe("outside");
  });
});

describe("outlineOffsetForPosition", () => {
  it("returns 0px for outside", () => {
    expect(outlineOffsetForPosition("outside", "4px")).toBe("0px");
  });

  it("returns -width/2 for center", () => {
    expect(outlineOffsetForPosition("center", "4px")).toBe("-2px");
  });

  it("rounds the center offset to one decimal for an odd width", () => {
    expect(outlineOffsetForPosition("center", "3px")).toBe("-1.5px");
  });

  it("round-trips center through readStrokeOutlinePosition", () => {
    const offset = outlineOffsetForPosition("center", "7px");
    expect(readStrokeOutlinePosition("7px", offset)).toBe("center");
  });
});

// ---------------------------------------------------------------------------
// deriveLockedAspectSize — W/H aspect-ratio lock: derives the paired
// dimension from the ratio captured when the lock was toggled on.
// ---------------------------------------------------------------------------

describe("deriveLockedAspectSize", () => {
  it("derives height from a width edit using width/height ratio", () => {
    // 200x100 -> ratio 2. Editing width to 300 should scale height to 150.
    expect(deriveLockedAspectSize("width", 300, 2)).toBe(150);
  });

  it("derives width from a height edit using width/height ratio", () => {
    expect(deriveLockedAspectSize("height", 150, 2)).toBe(300);
  });

  it("rounds the derived value to one decimal", () => {
    // ratio 3 (e.g. 300x100): editing width to 100 -> height 33.333... -> 33.3
    expect(deriveLockedAspectSize("width", 100, 3)).toBe(33.3);
  });

  it("round-trips width -> height -> width back to the original", () => {
    const ratio = 150 / 90; // arbitrary non-integer ratio
    const height = deriveLockedAspectSize("width", 150, ratio);
    const width = deriveLockedAspectSize("height", height, ratio);
    expect(width).toBeCloseTo(150, 1);
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

// ---------------------------------------------------------------------------
// fourValuesEqual — backs FlexContainerControls' paddingLinked and
// CornerRadiusControl's showIndependentCorners seed (STEVE TEST BATCH 4 #4).
// Both consumers must seed their linked/uniform toggle ONLY from a
// `useState` initializer on a component keyed per-selection, never from a
// reactive useEffect — see the callers in EditPanel.tsx for the full story
// on why a reactive re-derivation collapses the linked view mid-scrub.
// ---------------------------------------------------------------------------

describe("fourValuesEqual", () => {
  it("is true when all four sides/corners match", () => {
    expect(fourValuesEqual([16, 16, 16, 16])).toBe(true);
    expect(fourValuesEqual([0, 0, 0, 0])).toBe(true);
  });

  it("is false as soon as any one value differs", () => {
    expect(fourValuesEqual([16, 16, 16, 8])).toBe(false);
    expect(fourValuesEqual([8, 16, 16, 16])).toBe(false);
    expect(fourValuesEqual([16, 8, 16, 16])).toBe(false);
    expect(fourValuesEqual([16, 16, 8, 16])).toBe(false);
  });

  it("reflects the padding-scrub scenario: editing one linked axis makes it false", () => {
    // Starting state: all four sides equal (16), paddingLinked seeds true.
    const initial: [number, number, number, number] = [16, 16, 16, 16];
    expect(fourValuesEqual(initial)).toBe(true);

    // First scrub tick on the horizontal PaddingField sets left=right=17,
    // leaving top/bottom at 16 — this is the exact tick that used to flip
    // paddingLinked to false via the removed reactive useEffect.
    const afterOneScrubTick: [number, number, number, number] = [
      16, 17, 16, 17,
    ];
    expect(fourValuesEqual(afterOneScrubTick)).toBe(false);
    // The regression test that matters is *behavioral*, not this predicate:
    // FlexContainerControls must not re-run useState's initializer from this
    // (React only calls it once per mount), so paddingLinked stays true for
    // the rest of the gesture even though fourValuesEqual now reports false.
  });
});
