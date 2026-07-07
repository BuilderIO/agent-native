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

import { describe, expect, it } from "vitest";

import type { ElementInfo } from "../types";
import { isTextElement } from "./element-classification";

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
