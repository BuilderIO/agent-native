import { describe, expect, it } from "vitest";

import {
  drillInCandidateKey,
  drillInChainAtPoint,
  resolveDrillInTarget,
} from "./drill-in";
import type { CanvasLayerMarqueeCandidate } from "./types";

function candidate(
  sourceId: string,
  geometry: { x: number; y: number; width: number; height: number },
  options?: { screenId?: string; selector?: string; rotation?: number },
): CanvasLayerMarqueeCandidate {
  return {
    screenId: options?.screenId ?? "screen-1",
    info: {
      tagName: "div",
      sourceId,
      selector: options?.selector,
      classes: [],
      computedStyles: {},
      isFlexChild: false,
      isFlexContainer: false,
      boundingRect: {
        x: geometry.x,
        y: geometry.y,
        width: geometry.width,
        height: geometry.height,
      },
    } as CanvasLayerMarqueeCandidate["info"],
    geometry: { ...geometry, rotation: options?.rotation },
    frameGeometry: { x: 0, y: 0, width: 400, height: 800 },
  };
}

// A frame with a section containing a heading, all overlapping at (60, 60).
const SECTION = candidate("section", { x: 0, y: 0, width: 400, height: 300 });
const HEADING = candidate("heading", { x: 40, y: 40, width: 200, height: 60 });
const SPAN = candidate("span", { x: 50, y: 50, width: 80, height: 30 });
const ELSEWHERE = candidate("aside", { x: 300, y: 400, width: 80, height: 80 });

describe("drillInChainAtPoint", () => {
  it("orders the containment chain outermost to innermost", () => {
    const chain = drillInChainAtPoint({
      candidates: [SPAN, SECTION, HEADING],
      screenId: "screen-1",
      point: { x: 60, y: 60 },
    });
    expect(chain.map((c) => c.info.sourceId)).toEqual([
      "section",
      "heading",
      "span",
    ]);
  });

  it("excludes boxes that do not contain the point", () => {
    const chain = drillInChainAtPoint({
      candidates: [SECTION, HEADING, ELSEWHERE],
      screenId: "screen-1",
      point: { x: 60, y: 60 },
    });
    expect(chain.map((c) => c.info.sourceId)).not.toContain("aside");
  });

  it("excludes candidates belonging to another screen", () => {
    const other = candidate(
      "other-heading",
      { x: 40, y: 40, width: 200, height: 60 },
      { screenId: "screen-2" },
    );
    const chain = drillInChainAtPoint({
      candidates: [SECTION, other],
      screenId: "screen-1",
      point: { x: 60, y: 60 },
    });
    expect(chain.map((c) => c.info.sourceId)).toEqual(["section"]);
  });

  it("respects rotation when testing containment", () => {
    // A thin horizontal bar rotated 90° no longer covers a point to its right.
    const bar = candidate(
      "bar",
      { x: 0, y: 90, width: 400, height: 20 },
      { rotation: 90 },
    );
    const chain = drillInChainAtPoint({
      candidates: [bar],
      screenId: "screen-1",
      point: { x: 380, y: 100 },
    });
    expect(chain).toHaveLength(0);
  });

  it("breaks equal-area ties by selector depth, shallowest first", () => {
    const parent = candidate(
      "wrapper",
      { x: 0, y: 0, width: 100, height: 100 },
      { selector: "body > div" },
    );
    const child = candidate(
      "filler",
      { x: 0, y: 0, width: 100, height: 100 },
      { selector: "body > div > p" },
    );
    const chain = drillInChainAtPoint({
      candidates: [child, parent],
      screenId: "screen-1",
      point: { x: 50, y: 50 },
    });
    expect(chain.map((c) => c.info.sourceId)).toEqual(["wrapper", "filler"]);
  });
});

describe("resolveDrillInTarget", () => {
  const candidates = [SPAN, SECTION, HEADING];

  it("selects the outermost child on the first double-click", () => {
    const target = resolveDrillInTarget({
      candidates,
      screenId: "screen-1",
      point: { x: 60, y: 60 },
    });
    expect(target?.info.sourceId).toBe("section");
  });

  it("descends one level per subsequent double-click", () => {
    const first = resolveDrillInTarget({
      candidates,
      screenId: "screen-1",
      point: { x: 60, y: 60 },
    })!;
    const second = resolveDrillInTarget({
      candidates,
      screenId: "screen-1",
      point: { x: 60, y: 60 },
      previousKey: drillInCandidateKey(first),
    })!;
    const third = resolveDrillInTarget({
      candidates,
      screenId: "screen-1",
      point: { x: 60, y: 60 },
      previousKey: drillInCandidateKey(second),
    })!;
    expect([first, second, third].map((c) => c.info.sourceId)).toEqual([
      "section",
      "heading",
      "span",
    ]);
  });

  it("stays at the deepest layer instead of cycling back to the top", () => {
    const deepest = resolveDrillInTarget({
      candidates,
      screenId: "screen-1",
      point: { x: 60, y: 60 },
      previousKey: drillInCandidateKey(SPAN),
    });
    expect(deepest?.info.sourceId).toBe("span");
  });

  it("restarts from the outermost child when the pointer moves off the chain", () => {
    const target = resolveDrillInTarget({
      candidates: [...candidates, ELSEWHERE],
      screenId: "screen-1",
      point: { x: 340, y: 440 },
      previousKey: drillInCandidateKey(SPAN),
    });
    expect(target?.info.sourceId).toBe("aside");
  });

  it("returns null when nothing selectable sits under the pointer", () => {
    // Callers must leave the frame selected here rather than substituting
    // Interact mode, which is the bug this replaced.
    expect(
      resolveDrillInTarget({
        candidates,
        screenId: "screen-1",
        point: { x: 390, y: 790 },
      }),
    ).toBeNull();
  });

  it("keys candidates distinctly when siblings share an empty identity", () => {
    const left = candidate("", { x: 0, y: 0, width: 50, height: 50 });
    const right = candidate("", { x: 50, y: 0, width: 50, height: 50 });
    expect(drillInCandidateKey(left)).not.toBe(drillInCandidateKey(right));
  });
});
