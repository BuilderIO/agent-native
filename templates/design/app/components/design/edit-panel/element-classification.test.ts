/**
 * isTextElement classification tests (B5-12 regression).
 *
 * The real-world payload that regressed: selecting a T-tool text primitive
 * nested inside a canvas-drawn rectangle (board/overview layer-panel
 * selection) produces an ElementInfo parsed from source HTML — it has NO
 * `primitiveKind` field even though the DOM node carries
 * data-an-primitive="text", and it has `isFlexContainer: true` because the
 * T-tool's text divs use `display: flex` for their own vertical alignment.
 * The old fallback heuristic excluded flex containers, so both branches
 * failed and the Typography section vanished for exactly these nodes.
 */

import { describe, expect, it, vi } from "vitest";

import type { AutoLayoutSizingAxis } from "../inspector";
import type { ElementInfo } from "../types";
import {
  availableSizingForElement,
  commitElementMinMax,
  commitElementSizing,
  componentNameForElementInfo,
  inferElementSizing,
  isContainerElement,
  measuredElementSize,
  isTextElement,
} from "./element-classification";

function makeElement(overrides: Partial<ElementInfo> = {}): ElementInfo {
  return {
    tagName: "div",
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 0, height: 0 },
    isFlexChild: false,
    isFlexContainer: false,
    ...overrides,
  } as ElementInfo;
}

describe("isTextElement — B5-12 nested board text regression", () => {
  it("classifies the exact real-design payload (flex text primitive without primitiveKind) as text", () => {
    // Mirrors the persisted design-selection payload captured from the real
    // AI-generated todo design: div tag, draft-text-* source id, no
    // primitiveKind, flex container, childless, own text content.
    const element = makeElement({
      tagName: "div",
      sourceId: "draft-text-1783385467477-aur5b5",
      isFlexChild: true,
      isFlexContainer: true,
      childElementCount: 0,
      textContent: "hello world",
      computedStyles: {
        width: "180px",
        height: "18px",
        display: "flex",
        color: "rgb(255, 255, 255)",
        "font-size": "16px",
      },
    });
    expect(isTextElement(element)).toBe(true);
  });

  it("keeps a draft-rect-* rectangle primitive classified as non-text even when it carries text", () => {
    const element = makeElement({
      sourceId: "draft-rect-1783385461194-n2g67j",
      childElementCount: 0,
      textContent: "incidental label",
    });
    expect(isTextElement(element)).toBe(false);
  });

  it("classifies a childless flex div with its own text as text (no primitive markers at all)", () => {
    // The flex-container exclusion was the bug: T-tool text divs ARE flex
    // containers, so "is flex" must not imply "not text" for a leaf node.
    const element = makeElement({
      isFlexContainer: true,
      childElementCount: 0,
      textContent: "Some caption",
    });
    expect(isTextElement(element)).toBe(true);
  });

  it("still rejects empty shapes (no text content)", () => {
    const element = makeElement({
      isFlexContainer: true,
      childElementCount: 0,
      textContent: "   ",
    });
    expect(isTextElement(element)).toBe(false);
  });

  it("still rejects containers with element children", () => {
    const element = makeElement({
      childElementCount: 3,
      textContent: "Finalize Q3 roadmap deck high #planning",
    });
    expect(isTextElement(element)).toBe(false);
  });

  it("prefers primitiveKind when present — text", () => {
    const element = makeElement({
      primitiveKind: "text",
      childElementCount: 0,
    });
    expect(isTextElement(element)).toBe(true);
  });

  it("prefers primitiveKind when present — rectangle beats text-like heuristics", () => {
    const element = makeElement({
      primitiveKind: "rectangle",
      childElementCount: 0,
      textContent: "text inside a shape",
    });
    expect(isTextElement(element)).toBe(false);
  });

  it("honors pendingNodeId draft-text- prefix when sourceId is absent", () => {
    const element = makeElement({
      pendingNodeId: "draft-text-1780000000000-abc123",
      isFlexContainer: true,
      childElementCount: 0,
      // No textContent — id prefix alone is authoritative for tool-drawn
      // primitives (a just-created empty text box is still a text box).
    });
    expect(isTextElement(element)).toBe(true);
  });

  it("classic text tags remain text regardless of other fields", () => {
    const element = makeElement({
      tagName: "span",
      childElementCount: 2,
      isFlexContainer: true,
    });
    expect(isTextElement(element)).toBe(true);
  });
});

describe("componentNameForElementInfo", () => {
  it("uses React source provenance when the DOM payload has no explicit component name", () => {
    expect(
      componentNameForElementInfo(
        makeElement({
          provenance: {
            sourceFile: "src/components/Card.tsx",
            line: 7,
            column: 9,
            component: "Card",
            method: "debug-source",
          },
        }),
      ),
    ).toBe("Card");
  });

  it("uses React source provenance when an explicit component annotation is blank", () => {
    expect(
      componentNameForElementInfo(
        makeElement({
          componentName: "   ",
          provenance: { component: "Card" },
        }),
      ),
    ).toBe("Card");
  });

  it("keeps an explicit component annotation authoritative", () => {
    expect(
      componentNameForElementInfo(
        makeElement({
          componentName: "AnnotatedCard",
          provenance: {
            sourceFile: "src/components/Card.tsx",
            line: 7,
            column: 9,
            component: "Card",
            method: "debug-source",
          },
        }),
      ),
    ).toBe("AnnotatedCard");
  });
});

describe("isContainerElement — primitive inspector layout semantics", () => {
  it("treats empty rectangle and frame primitives as containers", () => {
    expect(
      isContainerElement(
        makeElement({
          primitiveKind: "rectangle",
          sourceId: "draft-rect-1",
          childElementCount: 0,
        }),
      ),
    ).toBe(true);
    expect(
      isContainerElement(
        makeElement({
          primitiveKind: "frame",
          sourceId: "draft-frame-1",
          childElementCount: 0,
        }),
      ),
    ).toBe(true);
  });

  it("does not mistake a flex-backed T-tool primitive for a container", () => {
    expect(
      isContainerElement(
        makeElement({
          primitiveKind: "text",
          sourceId: "draft-text-1",
          isFlexContainer: true,
          childElementCount: 0,
          textContent: "Label",
        }),
      ),
    ).toBe(false);
  });

  it("keeps div-backed non-container drawing primitives as leaves", () => {
    for (const primitiveKind of [
      "ellipse",
      "line",
      "arrow",
      "polygon",
      "star",
      "path",
    ]) {
      expect(
        isContainerElement(
          makeElement({ primitiveKind, childElementCount: 0 }),
        ),
      ).toBe(false);
    }
  });

  // Regression: the `isTextElement(element)) return false` short-circuit
  // added to fix the flex-backed T-tool text primitive case above (a real
  // `primitiveKind: "text"` marker) was too broad — it also ran
  // `isTextElement`'s generic childless-div-with-text fallback, which has
  // nothing to do with the T-tool and matches any ordinary content div with
  // no primitive/tag/id marker at all. That silently stripped the
  // Flow/Padding/Auto-layout sections from ordinary Tailwind pill/badge/
  // button-label divs — ubiquitous in generated markup — even though they
  // hit `isFlexContainer`/`CONTAINER_TAGS` and were correctly treated as
  // containers before that short-circuit existed.
  it("still treats a childless flex div with its own text as a container (no primitive markers at all)", () => {
    expect(
      isContainerElement(
        makeElement({
          isFlexContainer: true,
          childElementCount: 0,
          textContent: "3 new",
        }),
      ),
    ).toBe(true);
  });

  it("still treats a plain childless div with its own text and container-ish classes as a container", () => {
    expect(
      isContainerElement(
        makeElement({
          classes: ["inline-flex", "items-center", "rounded-full", "px-3"],
          childElementCount: 0,
          textContent: "Badge label",
        }),
      ),
    ).toBe(true);
  });
});

// ─── commitElementMinMax — scrub gesture meta threading (B5-14 follow-up) ────
//
// Min/max constraint fields are ScrubInputs; dropping their gesture meta on
// the way to onStyleChange forces every preview tick down the slow persist
// path (same class of bug as the padding/gap chain). The helper must forward
// the meta verbatim so preview ticks hit the host's live fast path and only
// the release commit persists.
describe("commitElementMinMax — meta forwarding", () => {
  it("forwards preview-phase meta on a set", () => {
    const onStyleChange = vi.fn();
    commitElementMinMax("horizontal", "min", 120, onStyleChange, {
      phase: "preview",
    });
    expect(onStyleChange).toHaveBeenCalledWith("minWidth", "120px", {
      phase: "preview",
    });
  });

  it("forwards commit-phase meta on a set", () => {
    const onStyleChange = vi.fn();
    commitElementMinMax("vertical", "max", 300, onStyleChange, {
      phase: "commit",
    });
    expect(onStyleChange).toHaveBeenCalledWith("maxHeight", "300px", {
      phase: "commit",
    });
  });

  it("clearing (null) still works without meta — discrete remove action", () => {
    const onStyleChange = vi.fn();
    commitElementMinMax("horizontal", "max", null, onStyleChange);
    expect(onStyleChange).toHaveBeenCalledWith("maxWidth", "none", undefined);
  });
});

// Clip B 16:39-16:46 (7xCLOlVaAj3n): the reviewer repeatedly sets "Hug
// contents" on the `1W` button of a 1D/1W/1M/1Y segmented control and the
// inspector keeps reading W 42px, X 754, Y 340, Grow 0 / Shrink 1 /
// Basis auto across four sampled frames six seconds apart. `button` is in
// neither the container nor the text tag set, so Hug was never in the
// offered options at all.
describe("availableSizingForElement — hug availability", () => {
  const hugFor = (element: ElementInfo, axis: AutoLayoutSizingAxis) =>
    availableSizingForElement(element)[axis]?.includes("hug") ?? false;

  it("offers hug on a button that is a flex child", () => {
    const element = makeElement({
      tagName: "button",
      isFlexChild: true,
      parentDisplay: "flex",
      computedStyles: { width: "42px", height: "29.5px" },
      parentLayout: { flexDirection: "row" },
    });
    expect(hugFor(element, "horizontal")).toBe(true);
  });

  it.each(["td", "th", "summary", "figcaption", "output"])(
    "offers hug on <%s>, which is in neither tag set",
    (tagName) => {
      expect(hugFor(makeElement({ tagName }), "horizontal")).toBe(true);
    },
  );

  it.each(["img", "input", "svg", "iframe", "select"])(
    "withholds hug from the replaced leaf <%s>",
    (tagName) => {
      expect(hugFor(makeElement({ tagName }), "horizontal")).toBe(false);
    },
  );

  it("withholds hug from a drawn shape, which has no content to measure", () => {
    const element = makeElement({ tagName: "div", primitiveKind: "ellipse" });
    expect(hugFor(element, "horizontal")).toBe(false);
  });
});

describe("inferElementSizing — authored vs resolved size", () => {
  it("reads hug from the authored width when computedStyles resolved it to px", () => {
    // A bridge selection payload: getComputedStyle always resolves
    // width:fit-content to a pixel value, so computedStyles alone can never
    // report hug.
    const element = makeElement({
      computedStyles: { width: "68px" },
      inlineStyles: { width: "fit-content" },
    });
    expect(inferElementSizing(element, "horizontal")).toBe("hug");
  });

  it("still reports fixed when the authored width is a pixel value", () => {
    const element = makeElement({
      computedStyles: { width: "42px" },
      inlineStyles: { width: "42px" },
    });
    expect(inferElementSizing(element, "horizontal")).toBe("fixed");
  });

  it("does not call an unknown parent direction the cross axis", () => {
    // Projection payloads omit parentLayout. Defaulting the direction to
    // horizontal made every vertical axis look like the cross axis, so an
    // align-self:stretch child read as "fill" on height.
    const element = makeElement({
      isFlexChild: true,
      parentDisplay: "flex",
      computedStyles: { height: "120px", alignSelf: "stretch" },
    });
    expect(inferElementSizing(element, "vertical")).toBe("fixed");
  });
});

describe("commitElementSizing — hug must undo a previous fill", () => {
  it("clears the cross-axis stretch a prior Fill wrote", () => {
    const onStyleChange = vi.fn();
    const onStylesChange = vi.fn();
    const element = makeElement({
      isFlexChild: true,
      parentDisplay: "flex",
      parentLayout: { flexDirection: "row" },
      computedStyles: { height: "120px", alignSelf: "stretch" },
    });
    commitElementSizing(
      element,
      "vertical",
      "hug",
      onStyleChange,
      onStylesChange,
    );
    const patch = onStylesChange.mock.calls[0]?.[0] as Record<string, string>;
    expect(patch.height).toBe("fit-content");
    expect(patch.alignSelf).toBe("auto");
  });

  it("uses justifySelf for a grid child's horizontal axis, both ways", () => {
    const element = makeElement({
      parentDisplay: "grid",
      computedStyles: { width: "200px" },
    });
    const fill = vi.fn();
    commitElementSizing(element, "horizontal", "fill", vi.fn(), fill);
    expect(
      (fill.mock.calls[0]?.[0] as Record<string, string>).justifySelf,
    ).toBe("stretch");
    const hug = vi.fn();
    commitElementSizing(element, "horizontal", "hug", vi.fn(), hug);
    expect((hug.mock.calls[0]?.[0] as Record<string, string>).justifySelf).toBe(
      "auto",
    );
  });
});

// The W field showed "437 Hug" — the mode was right, the number was the
// pre-commit boundingRect. Figma re-measures and shows the real width; without
// a fresh measurement the only honest readout is none.
describe("measuredElementSize", () => {
  it("reports the resolved px when the payload has one", () => {
    const element = makeElement({
      computedStyles: { width: "202px" },
      boundingRect: { x: 0, y: 0, width: 202, height: 20 },
    });
    expect(measuredElementSize(element, "horizontal")).toBe(202);
  });

  it("reports null for a keyword size instead of the stale rect", () => {
    const element = makeElement({
      computedStyles: { width: "fit-content" },
      boundingRect: { x: 0, y: 0, width: 202, height: 20 },
    });
    expect(measuredElementSize(element, "horizontal")).toBeNull();
  });

  it.each(["auto", "max-content", "min-content"])(
    "treats %s as unmeasurable",
    (value) => {
      expect(
        measuredElementSize(
          makeElement({
            computedStyles: { height: value },
            boundingRect: { x: 0, y: 0, width: 10, height: 44 },
          }),
          "vertical",
        ),
      ).toBeNull();
    },
  );

  it("falls back to the rect when computed styles carry no size at all", () => {
    const element = makeElement({
      computedStyles: {},
      boundingRect: { x: 0, y: 0, width: 120, height: 40 },
    });
    expect(measuredElementSize(element, "horizontal")).toBe(120);
  });

  it("reports null when neither source has a usable number", () => {
    const element = makeElement({
      computedStyles: { width: "fit-content" },
      boundingRect: { x: 0, y: 0, width: 0, height: 0 },
    });
    expect(measuredElementSize(element, "horizontal")).toBeNull();
  });
});
