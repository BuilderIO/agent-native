// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import type { AutoLayoutSizingAxis } from "../inspector";
import type { ElementChildLayout, ElementInfo } from "../types";
import {
  availableSizingForElement,
  canHugContent,
  commitElementMinMax,
  commitElementSizing,
  commitElementSizingForAxes,
  commitFixedElementSizes,
  componentNameForElementInfo,
  elementHasComponentAnnotation,
  inferElementSizing,
  inspectorObjectTitle,
  isBoxlessText,
  isContainerElement,
  measuredElementSize,
  parentFlexDirection,
  isTextElement,
  isVectorShapeElement,
} from "./element-classification";

function child(
  overrides: Partial<ElementChildLayout> = {},
): ElementChildLayout {
  return {
    nodeId: "child",
    tagName: "div",
    position: "static",
    display: "block",
    flexGrow: "0",
    alignSelf: "auto",
    justifySelf: "auto",
    float: "none",
    width: "auto",
    height: "auto",
    rect: { x: 0, y: 0, width: 40, height: 20 },
    ...overrides,
  };
}

function childLayouts(
  children: ElementChildLayout[],
  extra: { looseText?: boolean; complete?: boolean } = {},
): ElementInfo["childLayouts"] {
  return {
    children,
    looseText: extra.looseText ?? false,
    complete: extra.complete ?? true,
  };
}

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
    const element = makeElement({
      isFlexContainer: true,
      childElementCount: 0,
      textContent: "Some caption",
    });
    expect(isTextElement(element)).toBe(true);
  });

  it("classifies owned text in a mixed-content headline without hiding its layout controls", () => {
    const element = makeElement({
      classes: ["headline"],
      childElementCount: 2,
      textContent: "Your prompt. Production UI.",
      hasOwnText: true,
    });
    expect(isTextElement(element)).toBe(true);
    expect(isContainerElement(element)).toBe(true);
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

describe("isBoxlessText — corner radius on text", () => {
  const text = (computedStyles: Record<string, string> = {}) =>
    makeElement({ tagName: "h1", hasOwnText: true, computedStyles });

  it("does not expose corner rounding for plain text", () => {
    expect(
      isBoxlessText(
        text({
          backgroundColor: "rgba(0, 0, 0, 0)",
          backgroundImage: "none",
          borderTopWidth: "0px",
          borderTopStyle: "none",
          outlineWidth: "3px",
          outlineStyle: "none",
          outlineColor: "rgb(21, 24, 27)",
          boxShadow: "none",
          backdropFilter: "none",
          textShadow: "0px 4px 12px rgba(30, 158, 73, 0.57)",
        }),
      ),
    ).toBe(true);
  });

  it("does not count a gradient clipped to the glyphs as a box", () => {
    expect(
      isBoxlessText(
        text({
          backgroundImage: "linear-gradient(red, blue)",
          backgroundClip: "text",
        }),
      ),
    ).toBe(true);
  });

  it("keeps corner radius when HTML text paints a box", () => {
    expect(isBoxlessText(text({ backgroundColor: "rgb(255, 0, 0)" }))).toBe(
      false,
    );
    expect(
      isBoxlessText(text({ backgroundImage: "linear-gradient(red, blue)" })),
    ).toBe(false);
    expect(
      isBoxlessText(
        text({
          borderLeftWidth: "1px",
          borderLeftStyle: "solid",
          borderLeftColor: "rgb(0, 0, 0)",
        }),
      ),
    ).toBe(false);
    expect(
      isBoxlessText(text({ boxShadow: "rgb(0, 0, 0) 0px 2px 4px 0px" })),
    ).toBe(false);
    expect(isBoxlessText(text({ backdropFilter: "blur(8px)" }))).toBe(false);
  });

  it("never disables corner radius on non-text layers", () => {
    expect(isBoxlessText(makeElement({ tagName: "div" }))).toBe(false);
  });
});

describe("isVectorShapeElement — pasted SVG descendants", () => {
  it("uses SVG fill controls for drawable path and shape elements", () => {
    for (const tagName of [
      "path",
      "polygon",
      "polyline",
      "ellipse",
      "circle",
      "rect",
      "line",
    ]) {
      expect(isVectorShapeElement(makeElement({ tagName }))).toBe(true);
    }
  });

  it("does not expose SVG use instances as directly editable vector shapes", () => {
    expect(isVectorShapeElement(makeElement({ tagName: "use" }))).toBe(false);
  });

  it("keeps unmarked SVG containers and other elements out of vector classification", () => {
    expect(isVectorShapeElement(makeElement({ tagName: "svg" }))).toBe(false);
    expect(isVectorShapeElement(makeElement({ tagName: "div" }))).toBe(false);
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

describe("inspectorObjectTitle", () => {
  it("names an explicit Group wrapper instead of its div backing tag", () => {
    expect(
      inspectorObjectTitle(
        makeElement({ tagName: "div", isGroup: true, childElementCount: 2 }),
      ),
    ).toBe("Group");
  });

  it("keeps an explicit component name ahead of the Group label", () => {
    expect(
      inspectorObjectTitle(
        makeElement({
          tagName: "div",
          isGroup: true,
          componentName: "Card",
        }),
      ),
    ).toBe("Card");
  });

  it("classifies imported images, vectors, and frames from layer metadata", () => {
    expect(inspectorObjectTitle(makeElement({ tagName: "img" }))).toBe("Image");
    expect(inspectorObjectTitle(makeElement({ tagName: "svg" }))).toBe(
      "Vector",
    );
    expect(
      inspectorObjectTitle(
        makeElement({ tagName: "div", primitiveKind: "frame" }),
      ),
    ).toBe("Frame");
  });
});

describe("inspectorObjectTitle — layer types", () => {
  it("names drawn primitives by their shape, not their backing tag", () => {
    const title = (overrides: Partial<ElementInfo>) =>
      inspectorObjectTitle(makeElement(overrides));
    expect(title({ tagName: "div", primitiveKind: "rectangle" })).toBe(
      "Rectangle",
    );
    expect(title({ tagName: "div", primitiveKind: "rect" })).toBe("Rectangle");
    expect(title({ tagName: "div", primitiveKind: "ellipse" })).toBe("Ellipse");
    expect(title({ tagName: "svg", primitiveKind: "line" })).toBe("Line");
    expect(title({ tagName: "svg", primitiveKind: "arrow" })).toBe("Arrow");
    expect(title({ tagName: "svg", primitiveKind: "polygon" })).toBe("Polygon");
    expect(title({ tagName: "svg", primitiveKind: "star" })).toBe("Star");
    expect(title({ tagName: "svg", primitiveKind: "path" })).toBe("Vector");
  });

  it("names generated containers Frame, and Auto layout frame once they lay out children", () => {
    expect(
      inspectorObjectTitle(
        makeElement({
          tagName: "div",
          childElementCount: 2,
          computedStyles: { display: "block" },
        }),
      ),
    ).toBe("Frame");
    expect(
      inspectorObjectTitle(
        makeElement({
          tagName: "section",
          childElementCount: 2,
          isFlexContainer: true,
          computedStyles: { display: "flex" },
        }),
      ),
    ).toBe("Auto layout frame");
    expect(
      inspectorObjectTitle(
        makeElement({
          tagName: "div",
          primitiveKind: "frame",
          computedStyles: { display: "grid" },
          isGridContainer: true,
        }),
      ),
    ).toBe("Auto layout frame");
  });
});

describe("isContainerElement — primitive inspector layout semantics", () => {
  it("treats a frame as a container even when empty, a rectangle only once it holds layers", () => {
    expect(
      isContainerElement(
        makeElement({
          primitiveKind: "rectangle",
          sourceId: "draft-rect-1",
          childElementCount: 0,
        }),
      ),
    ).toBe(false);
    expect(
      isContainerElement(
        makeElement({
          primitiveKind: "rectangle",
          sourceId: "draft-rect-1",
          childElementCount: 1,
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

  it("keeps an explicit Group wrapper out of Auto layout", () => {
    expect(
      isContainerElement(
        makeElement({
          isGroup: true,
          isFlexContainer: true,
          childElementCount: 2,
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

  it("preserves fractional constraint values", () => {
    const onStyleChange = vi.fn();
    commitElementMinMax("horizontal", "min", 120.5, onStyleChange);
    expect(onStyleChange).toHaveBeenCalledWith(
      "minWidth",
      "120.5px",
      undefined,
    );
  });

  it("clearing (null) still works without meta — discrete remove action", () => {
    const onStyleChange = vi.fn();
    commitElementMinMax("horizontal", "max", null, onStyleChange);
    expect(onStyleChange).toHaveBeenCalledWith("maxWidth", "none", undefined);
  });
});

describe("availableSizingForElement — hug availability", () => {
  const hugFor = (element: ElementInfo, axis: AutoLayoutSizingAxis) =>
    availableSizingForElement(element)[axis]?.includes("hug") ?? false;

  it("offers hug on a button that is a flex child", () => {
    const element = makeElement({
      tagName: "button",
      isFlexChild: true,
      parentDisplay: "flex",
      childElementCount: 0,
      textContent: "1W",
      computedStyles: { width: "42px", height: "29.5px" },
      parentLayout: { flexDirection: "row" },
    });
    expect(hugFor(element, "horizontal")).toBe(true);
  });

  it.each(["td", "th", "summary", "figcaption", "output"])(
    "offers hug on <%s>, which is in neither tag set",
    (tagName) => {
      const element = makeElement({
        tagName,
        childElementCount: 0,
        textContent: "content",
      });
      expect(hugFor(element, "horizontal")).toBe(true);
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

describe("availableSizingForElement — fill eligibility", () => {
  const fillFor = (element: ElementInfo, axis: AutoLayoutSizingAxis) =>
    availableSizingForElement(element)[axis]?.includes("fill") ?? false;

  it.each(["flex", "grid"])(
    "withholds fill from out-of-flow children of a %s parent",
    (parentDisplay) => {
      for (const position of ["absolute", "fixed"]) {
        const element = makeElement({
          parentDisplay,
          textContent: "Ignored child",
          computedStyles: { position },
        });
        expect(fillFor(element, "horizontal")).toBe(false);
        expect(fillFor(element, "vertical")).toBe(false);
        expect(availableSizingForElement(element).horizontal).toContain("hug");
      }
    },
  );

  it("uses authored position when computed position is unavailable", () => {
    const element = makeElement({
      parentDisplay: "flex",
      inlineStyles: { position: "absolute" },
    });
    expect(fillFor(element, "horizontal")).toBe(false);
    expect(fillFor(element, "vertical")).toBe(false);
  });

  it.each(["flex", "grid"])(
    "keeps fill for an in-flow child of a %s parent",
    (parentDisplay) => {
      const element = makeElement({ parentDisplay });
      expect(fillFor(element, "horizontal")).toBe(true);
      expect(fillFor(element, "vertical")).toBe(true);
    },
  );

  it("keeps block-flow horizontal fill", () => {
    const element = makeElement({ parentDisplay: "block" });
    expect(fillFor(element, "horizontal")).toBe(true);
    expect(fillFor(element, "vertical")).toBe(false);
  });
});

describe("inferElementSizing — authored vs resolved size", () => {
  it("reads hug from the authored width when computedStyles resolved it to px", () => {
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

  it("prefers the winning stylesheet value over stale inline intent", () => {
    const element = makeElement({
      isFlexContainer: true,
      computedStyles: { width: "240px" },
      inlineStyles: { width: "auto" },
      authoredSizeStyles: { width: "240px" },
    });
    expect(inferElementSizing(element, "horizontal")).toBe("fixed");
  });

  it("distinguishes stylesheet-authored dimensions from flex/grid auto sizing", () => {
    const explicitFlex = makeElement({
      isFlexContainer: true,
      computedStyles: { width: "240px", height: "100px" },
      inlineStyles: {},
      authoredSizeStyles: { width: "240px", height: "100px" },
    });
    expect(inferElementSizing(explicitFlex, "horizontal")).toBe("fixed");
    expect(inferElementSizing(explicitFlex, "vertical")).toBe("fixed");

    const autoGrid = makeElement({
      isGridContainer: true,
      computedStyles: { width: "780px", height: "38px" },
      inlineStyles: {},
      authoredSizeStyles: { width: "auto", height: "auto" },
    });
    expect(inferElementSizing(autoGrid, "horizontal")).toBe("hug");
    expect(inferElementSizing(autoGrid, "vertical")).toBe("hug");
  });

  it("reads Hug from an auto-layout container with no authored height", () => {
    const element = makeElement({
      isFlexContainer: true,
      computedStyles: {
        display: "flex",
        width: "180px",
        height: "38.8px",
      },
      inlineStyles: { width: "fit-content" },
      authoredSizeStyles: { width: "fit-content", height: "auto" },
    });
    expect(inferElementSizing(element, "vertical")).toBe("hug");
  });

  it("does not infer Hug from a resolved px size when native evidence is absent", () => {
    const element = makeElement({
      isFlexContainer: true,
      computedStyles: { height: "38.8px" },
      inlineStyles: {},
    });
    expect(inferElementSizing(element, "vertical")).toBe("fixed");
  });

  it("keeps stylesheet-sized containers fixed when the authored snapshot has no inline value", () => {
    const element = makeElement({
      isGridContainer: true,
      computedStyles: { width: "240px" },
      inlineStyles: {},
      authoredSizeStyles: {},
    });
    expect(inferElementSizing(element, "horizontal")).toBe("fixed");
  });

  it("keeps a non-container with no authored height conservative", () => {
    const element = makeElement({
      computedStyles: { height: "38.8px" },
      inlineStyles: {},
    });
    expect(inferElementSizing(element, "vertical")).toBe("fixed");
  });

  it("reads a stretch child of a row parent as filling the cross axis", () => {
    const element = makeElement({
      isFlexChild: true,
      parentDisplay: "flex",
      computedStyles: { height: "120px", alignSelf: "stretch" },
    });
    expect(inferElementSizing(element, "vertical")).toBe("fill");
  });

  it("does not invent a cross axis when no parent is flex at all", () => {
    const element = makeElement({
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
      (fill.mock.calls[0]?.[0] as Record<string, string> | undefined)
        ?.justifySelf,
    ).toBe("stretch");
    const hug = vi.fn();
    commitElementSizing(element, "horizontal", "hug", vi.fn(), hug);
    expect(
      (hug.mock.calls[0]?.[0] as Record<string, string> | undefined)
        ?.justifySelf,
    ).toBe("auto");
  });

  it("commits numeric main-axis dimensions as fixed and preserves cross-axis Fill", () => {
    const onStylesChange = vi.fn();
    const element = makeElement({
      isFlexChild: true,
      parentDisplay: "flex",
      parentLayout: { display: "flex", flexDirection: "column" },
      inlineStyles: { width: "auto", height: "auto", alignSelf: "stretch" },
      computedStyles: {
        width: "278px",
        height: "227.2px",
        flexGrow: "1",
        flexShrink: "1",
        flexBasis: "0px",
        alignSelf: "stretch",
      },
    });

    commitFixedElementSizes(
      element,
      { vertical: 242 },
      vi.fn(),
      onStylesChange,
      { phase: "commit" },
    );

    const patch = onStylesChange.mock.calls[0]?.[0] as Record<string, string>;
    expect(patch).toEqual({
      height: "242px",
      flexGrow: "0",
      flexShrink: "0",
      flexBasis: "auto",
    });
    expect(onStylesChange).toHaveBeenCalledTimes(1);

    const updated = makeElement({
      ...element,
      inlineStyles: { ...element.inlineStyles, ...patch },
      computedStyles: { ...element.computedStyles, ...patch },
    });
    expect(inferElementSizing(updated, "vertical")).toBe("fixed");
    expect(inferElementSizing(updated, "horizontal")).toBe("fill");
  });

  it("clears cross-axis stretch when a layer changes from Fill to Fixed", () => {
    const onStylesChange = vi.fn();
    const element = makeElement({
      isFlexChild: true,
      parentDisplay: "flex",
      parentLayout: { display: "flex", flexDirection: "row" },
      inlineStyles: { height: "auto", alignSelf: "stretch" },
      computedStyles: { height: "242px", alignSelf: "stretch" },
    });

    commitElementSizing(element, "vertical", "fixed", vi.fn(), onStylesChange);

    const patch = onStylesChange.mock.calls[0]?.[0] as Record<string, string>;
    expect(patch).toEqual({ height: "242px", alignSelf: "auto" });
    expect(
      inferElementSizing(
        makeElement({
          ...element,
          inlineStyles: { ...element.inlineStyles, ...patch },
          computedStyles: { ...element.computedStyles, ...patch },
        }),
        "vertical",
      ),
    ).toBe("fixed");
  });

  it("commits both aspect-locked fixed dimensions in one patch", () => {
    const onStylesChange = vi.fn();
    const element = makeElement({
      isFlexChild: true,
      parentDisplay: "flex",
      parentLayout: { display: "flex", flexDirection: "column" },
      computedStyles: { width: "40px", height: "40px", flexShrink: "1" },
    });

    commitFixedElementSizes(
      element,
      { horizontal: 40, vertical: 242 },
      vi.fn(),
      onStylesChange,
    );

    expect(onStylesChange).toHaveBeenCalledTimes(1);
    expect(onStylesChange.mock.calls[0]?.[0]).toEqual({
      width: "40px",
      height: "242px",
      alignSelf: "auto",
      flexGrow: "0",
      flexShrink: "0",
      flexBasis: "auto",
    });
  });
});

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

describe("parentFlexDirection — unknown parent vs unknown direction", () => {
  it("defaults a flex parent with no authored direction to row", () => {
    const element = makeElement({
      isFlexChild: true,
      parentDisplay: "flex",
      parentLayout: { display: "flex" },
    });
    expect(parentFlexDirection(element)).toBe("horizontal");
  });

  it("still reports null when nothing says the parent is flex", () => {
    expect(parentFlexDirection(makeElement({}))).toBeNull();
  });

  it("honours an authored column direction", () => {
    const element = makeElement({
      isFlexChild: true,
      parentLayout: { display: "flex", flexDirection: "column" },
    });
    expect(parentFlexDirection(element)).toBe("vertical");
  });

  it("fills the main axis of an undeclared row parent", () => {
    const onStylesChange = vi.fn();
    commitElementSizing(
      makeElement({
        isFlexChild: true,
        parentDisplay: "flex",
        parentLayout: { display: "flex" },
        computedStyles: { width: "120px" },
      }),
      "horizontal",
      "fill",
      vi.fn(),
      onStylesChange,
    );
    const patch = onStylesChange.mock.calls[0]?.[0] as Record<string, string>;
    expect(patch.flexGrow).toBe("1");
    expect(patch.flexBasis).toBe("0");
    expect(patch.alignSelf).toBeUndefined();
  });
});

describe("measuredElementSize — zero is a size, not an absence", () => {
  it("reports 0 for a collapsed layer", () => {
    const element = makeElement({
      computedStyles: { width: "0px" },
      boundingRect: { x: 0, y: 0, width: 0, height: 0 },
    });
    expect(measuredElementSize(element, "horizontal")).toBe(0);
  });

  it("still reports null for the projection's placeholder rect", () => {
    const element = makeElement({
      computedStyles: {},
      boundingRect: { x: 0, y: 0, width: 0, height: 0 },
    });
    expect(measuredElementSize(element, "horizontal")).toBeNull();
  });
});

describe("canHugContent — Hug availability", () => {
  it("offers Hug to an empty auto-layout frame before it has children", () => {
    const element = makeElement({
      primitiveKind: "frame",
      isFlexContainer: true,
      childElementCount: 0,
      textContent: undefined,
      computedStyles: { padding: "10px" },
    });
    expect(canHugContent(element)).toBe(true);
    expect(availableSizingForElement(element).vertical).toContain("hug");
  });

  it("withholds hug from an empty drawn rectangle", () => {
    const element = makeElement({
      primitiveKind: "rectangle",
      childElementCount: 0,
      textContent: undefined,
    });
    expect(canHugContent(element)).toBe(false);
  });

  it("offers hug to a rectangle whose children sit in flow", () => {
    const element = makeElement({
      primitiveKind: "rectangle",
      childElementCount: 2,
      childLayouts: childLayouts([
        child({ tagName: "p" }),
        child({ tagName: "p" }),
      ]),
    });
    expect(canHugContent(element)).toBe(true);
  });

  it("withholds hug from a rectangle whose child layout is unreadable", () => {
    const element = makeElement({
      primitiveKind: "rectangle",
      childElementCount: 2,
    });
    expect(canHugContent(element)).toBe(false);
  });

  it("withholds hug from an empty plain container", () => {
    expect(
      canHugContent(makeElement({ tagName: "div", childElementCount: 0 })),
    ).toBe(false);
  });

  it("offers hug to a text primitive even while empty", () => {
    const element = makeElement({
      primitiveKind: "text",
      childElementCount: 0,
    });
    expect(canHugContent(element)).toBe(true);
  });

  it("treats an absent content signal as unknown, not empty", () => {
    expect(canHugContent(makeElement({ tagName: "div" }))).toBe(true);
  });
});

describe("isVectorShapeElement", () => {
  it("accepts a drawn vector, whose paint lives on an SVG shape child", () => {
    expect(
      isVectorShapeElement(
        makeElement({ tagName: "svg", primitiveKind: "path" }),
      ),
    ).toBe(true);
    expect(
      isVectorShapeElement(
        makeElement({ tagName: "svg", primitiveKind: "polygon" }),
      ),
    ).toBe(true);
    expect(
      isVectorShapeElement(
        makeElement({ tagName: "svg", primitiveKind: "boolean" }),
      ),
    ).toBe(true);
    expect(
      isVectorShapeElement(
        makeElement({ tagName: "svg", primitiveKind: "boolean-operand" }),
      ),
    ).toBe(true);
  });

  it.each(["rect", "rectangle", "ellipse", "circle"])(
    "accepts an SVG %s wrapper for vector paint controls",
    (primitiveKind) => {
      expect(
        isVectorShapeElement(makeElement({ tagName: "svg", primitiveKind })),
      ).toBe(true);
    },
  );

  it("accepts the scoped pasted SVG marker", () => {
    expect(
      isVectorShapeElement(
        makeElement({ tagName: "svg", primitiveKind: "pasted-svg" }),
      ),
    ).toBe(true);
  });

  it("does not broaden unmarked inline SVG classification", () => {
    expect(isVectorShapeElement(makeElement({ tagName: "svg" }))).toBe(false);
  });

  it("rejects a board-migrated polygon, which is a div painted with background", () => {
    expect(
      isVectorShapeElement(
        makeElement({ tagName: "div", primitiveKind: "polygon" }),
      ),
    ).toBe(false);
  });

  it.each(["rectangle", "ellipse"])(
    "keeps the canvas %s div out of SVG vector controls",
    (primitiveKind) => {
      expect(
        isVectorShapeElement(makeElement({ tagName: "div", primitiveKind })),
      ).toBe(false);
    },
  );

  it("rejects frames and text", () => {
    expect(
      isVectorShapeElement(
        makeElement({ tagName: "div", primitiveKind: "frame" }),
      ),
    ).toBe(false);
  });
});

describe("elementHasComponentAnnotation", () => {
  it("is true only for an explicit annotation", () => {
    expect(
      elementHasComponentAnnotation({ componentName: "Button" } as never),
    ).toBe(true);
  });

  it("ignores React provenance, which names the renderer not the element", () => {
    expect(
      elementHasComponentAnnotation({
        provenance: { component: "Card" },
      } as never),
    ).toBe(false);
    expect(elementHasComponentAnnotation(null)).toBe(false);
  });
});

describe("a tag that usually carries text but holds none", () => {
  const row = (hasOwnText?: boolean): ElementInfo => ({
    tagName: "li",
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 260, height: 40 },
    isFlexChild: true,
    isFlexContainer: false,
    ...(hasOwnText === undefined ? {} : { hasOwnText }),
  });

  it("is a container, so its Fill is a background", () => {
    expect(isTextElement(row(false))).toBe(false);
  });

  it("is still text when it holds text directly", () => {
    expect(isTextElement(row(true))).toBe(true);
  });

  it("keeps the tag-only reading when the payload does not say", () => {
    expect(isTextElement(row())).toBe(true);
  });
});

describe("inline text style roots", () => {
  it("exposes Typography for a paragraph whose text is in inline spans", () => {
    const paragraph = makeElement({
      tagName: "p",
      hasOwnText: false,
      wholeTextStyleRoot: true,
      childElementCount: 1,
      textContent: "Shared note",
    });

    expect(isTextElement(paragraph)).toBe(true);
    expect(isContainerElement(paragraph)).toBe(false);
  });

  it("keeps a dot-label-checkbox row as a background-bearing container", () => {
    const row = makeElement({
      tagName: "li",
      hasOwnText: false,
      wholeTextStyleRoot: false,
      childElementCount: 3,
      isFlexContainer: true,
      textContent: "Done",
      computedStyles: { display: "flex", backgroundColor: "white" },
    });

    expect(isTextElement(row)).toBe(false);
    expect(isContainerElement(row)).toBe(true);
  });
});

describe("isVectorShapeElement for imported svg", () => {
  it("keeps an unmarked svg out of vector classification", () => {
    expect(isVectorShapeElement(makeElement({ tagName: "svg" }))).toBe(false);
  });
});

const absoluteChild = (nodeId: string) =>
  child({
    nodeId,
    position: "absolute",
    width: "40px",
    height: "40px",
    rect: { x: 12, y: 12, width: 40, height: 40 },
  });

describe("Hug needs content laid out in flow", () => {
  const hugFor = (element: ElementInfo, axis: AutoLayoutSizingAxis) =>
    availableSizingForElement(element)[axis]?.includes("hug") ?? false;

  it("withholds Hug from a freeform frame whose children are all absolutely positioned", () => {
    const element = makeElement({
      primitiveKind: "frame",
      childElementCount: 2,
      childLayouts: childLayouts([absoluteChild("a"), absoluteChild("b")]),
      computedStyles: { display: "block", position: "relative" },
    });
    expect(hugFor(element, "horizontal")).toBe(false);
    expect(hugFor(element, "vertical")).toBe(false);
  });

  it("withholds Hug from a plain container whose children are all out of flow", () => {
    const element = makeElement({
      tagName: "div",
      childElementCount: 2,
      childLayouts: childLayouts([
        absoluteChild("a"),
        child({ nodeId: "overlay", tagName: "span", position: "fixed" }),
      ]),
      computedStyles: { display: "block", position: "relative" },
    });
    expect(hugFor(element, "horizontal")).toBe(false);
  });

  it("withholds Hug from a frame without auto layout when its children are not readable", () => {
    const element = makeElement({
      primitiveKind: "frame",
      childElementCount: 2,
      computedStyles: { display: "block" },
    });
    expect(hugFor(element, "horizontal")).toBe(false);
  });

  it("keeps Hug for a container with one child in flow beside absolute ones", () => {
    const element = makeElement({
      tagName: "div",
      childElementCount: 2,
      childLayouts: childLayouts([
        absoluteChild("a"),
        child({ nodeId: "caption", tagName: "p" }),
      ]),
    });
    expect(hugFor(element, "horizontal")).toBe(true);
  });

  it("keeps Hug for a freeform frame that holds loose text", () => {
    const element = makeElement({
      primitiveKind: "frame",
      childElementCount: 1,
      childLayouts: childLayouts([absoluteChild("a")], { looseText: true }),
    });
    expect(hugFor(element, "horizontal")).toBe(true);
  });

  it("keeps Hug for an auto layout frame even when every child is absolute", () => {
    const element = makeElement({
      primitiveKind: "frame",
      isFlexContainer: true,
      childElementCount: 1,
      childLayouts: childLayouts([absoluteChild("a")]),
    });
    expect(hugFor(element, "horizontal")).toBe(true);
  });

  it("does not trust a truncated child list to prove every child is out of flow", () => {
    const element = makeElement({
      tagName: "div",
      childElementCount: 400,
      childLayouts: childLayouts([absoluteChild("a")], { complete: false }),
    });
    expect(hugFor(element, "horizontal")).toBe(true);
  });
});

describe("Fill needs an in-flow child", () => {
  it.each(["absolute", "fixed"])(
    "withholds fill from a %s child of a block parent",
    (position) => {
      const element = makeElement({
        parentDisplay: "block",
        computedStyles: { position, width: "120px" },
      });
      expect(availableSizingForElement(element).horizontal).not.toContain(
        "fill",
      );
    },
  );
});

describe("Hug on a parent freezes the children that fill that axis", () => {
  const frame = (
    children: ElementChildLayout[],
    flexDirection = "row",
  ): ElementInfo =>
    makeElement({
      sourceId: "frame",
      isFlexContainer: true,
      childElementCount: children.length,
      childLayouts: childLayouts(children),
      computedStyles: {
        display: "flex",
        flexDirection,
        width: "320px",
        height: "80px",
      },
      authoredSizeStyles: { width: "320px", height: "80px" },
    });
  const grower = child({
    nodeId: "grow",
    flexGrow: "1",
    rect: { x: 0, y: 0, width: 212.4, height: 40 },
  });

  it("offers Hug on the main axis a child grows along", () => {
    const sizing = availableSizingForElement(frame([grower, child()]));
    expect(sizing.horizontal).toContain("hug");
  });

  it("writes the frame and the frozen child as one multi-node edit", () => {
    const onStylesChange = vi.fn();
    const onApplyLayoutFlow = vi.fn(() => "applied" as const);
    commitElementSizing(
      frame([grower, child({ nodeId: "fixed", width: "40px" })]),
      "horizontal",
      "hug",
      vi.fn(),
      onStylesChange,
      onApplyLayoutFlow,
    );
    expect(onStylesChange).not.toHaveBeenCalled();
    expect(onApplyLayoutFlow).toHaveBeenCalledTimes(1);
    const [nodeId, containerStyles, patches] = onApplyLayoutFlow.mock
      .calls[0] as unknown as [string, object, Map<string, object>];
    expect(nodeId).toBe("frame");
    expect(containerStyles).toEqual({});
    expect(Object.fromEntries(patches)).toEqual({
      frame: { width: "fit-content" },
      grow: {
        width: "212px",
        flexGrow: "0",
        flexShrink: "0",
        flexBasis: "auto",
      },
    });
  });

  it("freezes a child sized 100% along a column's cross axis", () => {
    const onApplyLayoutFlow = vi.fn(() => "applied" as const);
    commitElementSizing(
      frame(
        [
          child({
            nodeId: "full",
            width: "100%",
            rect: { x: 0, y: 0, width: 320, height: 20 },
          }),
        ],
        "column",
      ),
      "horizontal",
      "hug",
      vi.fn(),
      vi.fn(),
      onApplyLayoutFlow,
    );
    const patches = (onApplyLayoutFlow.mock.calls[0] as unknown[])[2] as Map<
      string,
      Record<string, string>
    >;
    expect(patches.get("full")).toEqual({
      width: "320px",
      alignSelf: "auto",
    });
  });

  it("leaves a cross-axis stretch child alone: the line sizes before it stretches", () => {
    const sizing = availableSizingForElement(
      frame([child({ nodeId: "stretch", alignSelf: "stretch" }), child()]),
    );
    expect(sizing.vertical).toContain("hug");
    const onStylesChange = vi.fn();
    commitElementSizing(
      frame([child({ nodeId: "stretch", alignSelf: "stretch" })]),
      "vertical",
      "hug",
      vi.fn(),
      onStylesChange,
      vi.fn(),
    );
    expect(onStylesChange.mock.calls[0]?.[0]).toEqual({
      height: "fit-content",
    });
  });

  it("withholds Hug while a filling child cannot be frozen in place", () => {
    const sizing = availableSizingForElement(
      frame([child({ nodeId: undefined, flexGrow: "1" })]),
    );
    expect(sizing.horizontal).not.toContain("hug");
    expect(sizing.vertical).toContain("hug");
  });

  it("ignores a filling child that is out of flow", () => {
    const sizing = availableSizingForElement(
      frame([
        child({ nodeId: undefined, position: "absolute", width: "100%" }),
        child(),
      ]),
    );
    expect(sizing.horizontal).toContain("hug");
  });
});

describe("inferElementSizing — the mode the layer is actually in", () => {
  it("reads a column child that the parent stretches as Fill on the cross axis", () => {
    const element = makeElement({
      isFlexChild: true,
      parentDisplay: "flex",
      parentLayout: {
        display: "flex",
        flexDirection: "column",
        alignItems: "normal",
      },
      computedStyles: { width: "320px", height: "40px", alignSelf: "auto" },
      authoredSizeStyles: { width: "auto", height: "auto" },
    });
    expect(inferElementSizing(element, "horizontal")).toBe("fill");
    expect(inferElementSizing(element, "vertical")).toBe("hug");
  });

  it("keeps Hug when the parent aligns its children instead of stretching them", () => {
    const element = makeElement({
      isFlexChild: true,
      parentDisplay: "flex",
      parentLayout: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      },
      computedStyles: { width: "120px", alignSelf: "auto" },
      authoredSizeStyles: { width: "auto" },
    });
    expect(inferElementSizing(element, "horizontal")).toBe("hug");
  });

  it("reads a block child with auto width as filling its block parent", () => {
    const element = makeElement({
      parentDisplay: "block",
      computedStyles: { display: "block", width: "600px", height: "48px" },
      authoredSizeStyles: { width: "auto", height: "auto" },
    });
    expect(inferElementSizing(element, "horizontal")).toBe("fill");
    expect(inferElementSizing(element, "vertical")).toBe("hug");
  });

  it.each([
    ["inline-block", "static", "none"],
    ["block", "absolute", "none"],
    ["block", "static", "left"],
  ])(
    "reads a %s / %s / float %s auto-width child of a block parent as Hug",
    (display, position, float) => {
      const element = makeElement({
        parentDisplay: "block",
        computedStyles: { display, position, float, width: "80px" },
        authoredSizeStyles: { width: "auto" },
      });
      expect(inferElementSizing(element, "horizontal")).toBe("hug");
    },
  );

  it("reads back the Fill the inspector writes for a grid child", () => {
    const element = makeElement({
      parentDisplay: "grid",
      computedStyles: { width: "200px", justifySelf: "stretch" },
      inlineStyles: { width: "auto", justifySelf: "stretch" },
    });
    expect(inferElementSizing(element, "horizontal")).toBe("fill");
  });

  it("reports the same modes after a code-layer refresh drops the measured sizes", () => {
    const parentLayout = {
      display: "flex",
      flexDirection: "column",
      alignItems: "normal",
    };
    const live = makeElement({
      isFlexChild: true,
      parentDisplay: "flex",
      parentLayout,
      computedStyles: {
        display: "block",
        width: "320px",
        height: "40px",
        alignSelf: "auto",
      },
      inlineStyles: { padding: "8px" },
      authoredSizeStyles: { width: "auto", height: "auto" },
    });
    const refreshed = makeElement({
      isFlexChild: true,
      parentDisplay: "flex",
      parentLayout,
      computedStyles: { padding: "8px" },
      inlineStyles: { padding: "8px" },
      authoredSizeStyles: undefined,
    });
    for (const axis of ["horizontal", "vertical"] as const) {
      expect(inferElementSizing(refreshed, axis)).toBe(
        inferElementSizing(live, axis),
      );
    }
    expect(inferElementSizing(refreshed, "horizontal")).toBe("fill");
    expect(inferElementSizing(refreshed, "vertical")).toBe("hug");
  });

  it("keeps a utility-sized layer Fixed after a refresh drops its measured size", () => {
    const element = makeElement({
      classes: ["w-64", "p-4"],
      computedStyles: { padding: "16px" },
      inlineStyles: {},
    });
    expect(inferElementSizing(element, "horizontal")).toBe("fixed");
    expect(inferElementSizing(element, "vertical")).toBe("hug");
  });
});

describe("commitElementSizingForAxes — one patch for both axes", () => {
  it("commits Resize to fit as a single Hug patch", () => {
    const onStyleChange = vi.fn();
    const onStylesChange = vi.fn();
    const element = makeElement({
      isFlexChild: true,
      parentDisplay: "flex",
      parentLayout: { display: "flex", flexDirection: "row" },
      isFlexContainer: true,
      computedStyles: { width: "200px", height: "80px", flexGrow: "1" },
    });
    commitElementSizingForAxes(
      element,
      { horizontal: "hug", vertical: "hug" },
      onStyleChange,
      onStylesChange,
    );
    expect(onStyleChange).not.toHaveBeenCalled();
    expect(onStylesChange).toHaveBeenCalledTimes(1);
    expect(onStylesChange.mock.calls[0]?.[0]).toEqual({
      width: "fit-content",
      height: "fit-content",
      flexGrow: "0",
      flexShrink: "0",
      flexBasis: "auto",
      alignSelf: "auto",
    });
  });
});
