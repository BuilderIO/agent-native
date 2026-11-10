import { describe, expect, it } from "vitest";

import {
  arrangeOpenStack,
  type CommentThreadPosition,
} from "./CommentsSidebar";

const HEADER = 28;
const GAP = 12;

// Four cards in one paragraph, in document order, with their heights.
const CARDS = [
  { threadId: "a", height: 80 },
  { threadId: "b", height: 120 },
  { threadId: "c", height: 80 },
  { threadId: "d", height: 100 },
];

function at(layoutTop: number | null): Map<string, CommentThreadPosition> {
  return new Map(
    CARDS.map((card, index) => [
      card.threadId,
      { documentTop: 400 + index, layoutTop },
    ]),
  );
}

/** Where each card lands, top to bottom, once the stack's top is placed. */
function placed(
  stack: ReturnType<typeof arrangeOpenStack>,
  top = stack.layoutTop ?? 0,
) {
  return [...stack.offsets]
    .sort(([, left], [, right]) => left - right)
    .map(([threadId, offset]) => [threadId, top + offset]);
}

describe("open comment stack layout", () => {
  it("keeps document order, with the focused card level with its highlight, when the cards before it fit above", () => {
    const stack = arrangeOpenStack(CARDS, "c", at(400), HEADER);
    // Collapse row, a, b, then c at its highlight.
    expect(placed(stack)).toEqual([
      ["a", 176],
      ["b", 268],
      ["c", 400],
      ["d", 492],
    ]);
    expect(stack.layoutTop).toBe(136);
    expect(stack.height).toBe(
      HEADER + GAP + 80 + GAP + 120 + GAP + 80 + GAP + 100,
    );
  });

  it("puts the focused card first near the top of the margin, so the Collapse row stays in reach", () => {
    // a and b need 264px above c, and the margin has only 150.
    const stack = arrangeOpenStack(CARDS, "c", at(150), HEADER);
    expect(placed(stack)).toEqual([
      ["c", 150],
      ["a", 242],
      ["b", 334],
      ["d", 466],
    ]);
    // The Collapse row sits right above c, inside the margin.
    expect(stack.layoutTop).toBe(150 - HEADER - GAP);
    expect(stack.layoutTop).toBeGreaterThanOrEqual(0);
  });

  it("keeps document order when the cards before the focused one just fit", () => {
    const stack = arrangeOpenStack(CARDS, "c", at(264), HEADER);
    expect(placed(stack).map(([threadId]) => threadId)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(stack.layoutTop).toBe(0);
  });

  it("leaves a stack whose first card is in focus in document order", () => {
    const stack = arrangeOpenStack(CARDS, "a", at(20), HEADER);
    expect(placed(stack).map(([threadId]) => threadId)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    // Too close to the top for the Collapse row: the margin's layout clamps
    // the stack at 0, the closest a reachable Collapse row allows.
    expect(stack.layoutTop).toBe(20 - HEADER - GAP);
  });

  it("lines a new comment in the stack up with its selection, like a selected card", () => {
    const cards = [...CARDS.slice(0, 2), { threadId: "draft", height: 112 }];
    const positions = at(180).set("draft", {
      documentTop: 402,
      layoutTop: 180,
    });
    const stack = arrangeOpenStack(cards, "draft", positions, HEADER);
    expect(placed(stack)).toEqual([
      ["draft", 180],
      ["a", 304],
      ["b", 396],
    ]);
  });

  it("anchors a stack with no card in focus by its first card", () => {
    const stack = arrangeOpenStack(CARDS, null, at(300), HEADER);
    expect(placed(stack)[0]).toEqual(["a", 300]);
    expect(stack.layoutTop).toBe(300 - HEADER - GAP);
  });

  it("has no anchored top where the margin lays cards out in sequence", () => {
    const stack = arrangeOpenStack(CARDS, "c", at(null), HEADER);
    expect(stack.layoutTop).toBeNull();
    expect(placed(stack, 0).map(([threadId]) => threadId)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });
});
