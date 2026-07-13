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

import type { ElementInfo } from "../types";
import {
  commitElementMinMax,
  isContainerElement,
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
