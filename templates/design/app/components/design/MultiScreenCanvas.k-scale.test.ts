/**
 * Unit tests for `applyDraftGeometry`'s K-scale (Figma "Scale" tool) parity:
 * when a draft primitive resize is driven by the K/scale tool
 * (`beginDraftResize`'s mousemove handler passes `scaleK: true`), the
 * draft's `strokeWidth` must grow/shrink proportionally with the resize's
 * uniform scale factor — exactly like Figma's Scale tool multiplies stroke
 * weight along with the box. A normal resize (`scaleK` omitted/false, the
 * default) must leave `strokeWidth` completely untouched — only `geometry`
 * changes.
 */

import { describe, expect, it } from "vitest";

import { applyDraftGeometry } from "./multi-screen/draft-primitives";
import type { DraftPrimitive, FrameGeometry } from "./multi-screen/types";

function rectDraft(overrides: Partial<DraftPrimitive> = {}): DraftPrimitive {
  return {
    id: "draft-1",
    kind: "rectangle",
    geometry: { x: 0, y: 0, width: 100, height: 100 },
    strokeWidth: 2,
    ...overrides,
  };
}

const DOUBLE: FrameGeometry = { x: 0, y: 0, width: 200, height: 200 };
const HALF: FrameGeometry = { x: 0, y: 0, width: 50, height: 50 };

describe("applyDraftGeometry — K-scale strokeWidth parity", () => {
  it("a normal resize (scaleK omitted) never touches strokeWidth", () => {
    const draft = rectDraft();
    const result = applyDraftGeometry(draft, DOUBLE);
    expect(result.geometry).toEqual(DOUBLE);
    expect(result.strokeWidth).toBe(2);
  });

  it("a normal resize (scaleK explicitly false) never touches strokeWidth", () => {
    const draft = rectDraft();
    const result = applyDraftGeometry(draft, DOUBLE, false);
    expect(result.strokeWidth).toBe(2);
  });

  it("K-scale doubles strokeWidth when the box doubles in size", () => {
    const draft = rectDraft({ strokeWidth: 2 });
    const result = applyDraftGeometry(draft, DOUBLE, true);
    expect(result.strokeWidth).toBe(4);
  });

  it("K-scale halves strokeWidth when the box is scaled down by half", () => {
    const draft = rectDraft({ strokeWidth: 4 });
    const result = applyDraftGeometry(draft, HALF, true);
    expect(result.strokeWidth).toBe(2);
  });

  it("K-scale uses the LARGER axis factor for a non-uniform resize", () => {
    // Width grows 3x, height only 1.5x — a stroke/font has no separate
    // horizontal/vertical component, so the larger factor wins (see the
    // doc comment on applyDraftGeometry for the rationale).
    const draft = rectDraft({ strokeWidth: 2 });
    const nonUniform: FrameGeometry = { x: 0, y: 0, width: 300, height: 150 };
    const result = applyDraftGeometry(draft, nonUniform, true);
    expect(result.strokeWidth).toBe(6); // 2 * max(3, 1.5)
  });

  it("K-scale leaves strokeWidth untouched when the draft has none set", () => {
    const draft = rectDraft({ strokeWidth: undefined });
    const result = applyDraftGeometry(draft, DOUBLE, true);
    expect(result.strokeWidth).toBeUndefined();
  });

  it("K-scale never produces a negative strokeWidth (clamped at 0)", () => {
    // Degenerate case: origin geometry collapsed to near-zero, producing an
    // enormous scale factor — Math.max(0, ...) still guards the floor even
    // though a huge positive factor can't go negative on its own; this
    // documents the clamp exists rather than asserting an impossible input.
    const draft = rectDraft({ strokeWidth: 2 });
    const result = applyDraftGeometry(
      { ...draft, geometry: { x: 0, y: 0, width: 1, height: 1 } },
      { x: 0, y: 0, width: 1000, height: 1000 },
      true,
    );
    expect(result.strokeWidth).toBeGreaterThanOrEqual(0);
  });

  it("normal resize still scales points/penPath geometry exactly as before this change", () => {
    const draft = rectDraft({
      strokeWidth: 2,
      points: [
        { x: 10, y: 10 },
        { x: 90, y: 90 },
      ],
    });
    const result = applyDraftGeometry(draft, DOUBLE);
    expect(result.points).toEqual([
      { x: 20, y: 20 },
      { x: 180, y: 180 },
    ]);
    // strokeWidth still untouched even though points did scale.
    expect(result.strokeWidth).toBe(2);
  });
});
