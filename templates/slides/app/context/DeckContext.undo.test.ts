// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  applyOpToDeck,
  deriveInverseOp,
  type Deck,
  type PatchDeckOp,
  type Slide,
} from "./DeckContext";

function slide(id: string, over: Partial<Slide> = {}): Slide {
  return {
    id,
    content: `<div class="fmd-slide">${id}</div>`,
    notes: "",
    layout: "content",
    ...over,
  };
}

function deck(slides: Slide[], over: Partial<Deck> = {}): Deck {
  return {
    id: "deck-1",
    title: "Deck",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    slides,
    ...over,
  };
}

/**
 * A deck comparison that ignores `updatedAt` (every op bumps it) so we can
 * assert the meaningful content round-trips exactly.
 */
function stripTimestamps(d: Deck): Omit<Deck, "updatedAt"> {
  const { updatedAt: _u, ...rest } = d;
  void _u;
  return rest;
}

/**
 * Property under test: applying an op then its derived inverse restores the
 * deck to its exact prior state (content-wise). This is the guarantee the
 * inverse-op undo system relies on.
 */
function expectRoundTrip(before: Deck, op: PatchDeckOp) {
  const inverseOps = deriveInverseOp(before, op);
  expect(inverseOps).not.toBeNull();
  const after = applyOpToDeck(before, op);
  // Apply every inverse op in order (delete-slide's inverse is two ops).
  let restored = after;
  for (const inv of inverseOps!) {
    restored = applyOpToDeck(restored, inv);
  }
  expect(stripTimestamps(restored)).toEqual(stripTimestamps(before));
}

describe("deriveInverseOp / applyOpToDeck round-trips", () => {
  it("patch-slide: inverse restores the prior field values", () => {
    const before = deck([
      slide("a", { content: "<div>original</div>", background: "bg-black" }),
      slide("b"),
    ]);
    const op: PatchDeckOp = {
      op: "patch-slide",
      slideId: "a",
      fields: { content: "<div>edited</div>", background: "bg-white" },
    };
    const after = applyOpToDeck(before, op);
    expect(after.slides[0].content).toBe("<div>edited</div>");
    expect(after.slides[0].background).toBe("bg-white");
    expectRoundTrip(before, op);
  });

  it("patch-slide inverse captures prior value even when a field was undefined", () => {
    const before = deck([slide("a")]); // no background set
    const op: PatchDeckOp = {
      op: "patch-slide",
      slideId: "a",
      fields: { background: "bg-red" },
    };
    const inverse = deriveInverseOp(before, op);
    // Inverse must set background back to undefined (its prior value).
    expect(inverse).toEqual([
      {
        op: "patch-slide",
        slideId: "a",
        fields: { background: undefined },
      },
    ]);
    expectRoundTrip(before, op);
  });

  it("patch-slide on a missing slide has no inverse (fails soft)", () => {
    const before = deck([slide("a")]);
    const op: PatchDeckOp = {
      op: "patch-slide",
      slideId: "ghost",
      fields: { content: "x" },
    };
    expect(deriveInverseOp(before, op)).toBeNull();
    // applying to a missing slide is a no-op
    expect(applyOpToDeck(before, op)).toBe(before);
  });

  it("add-slide: inverse is delete-slide, restoring the exact prior deck", () => {
    const before = deck([slide("a"), slide("b")]);
    const op: PatchDeckOp = {
      op: "add-slide",
      slideId: "c",
      afterSlideId: "a",
      fields: { content: "<div>c</div>", notes: "n", layout: "title" },
    };
    const after = applyOpToDeck(before, op);
    expect(after.slides.map((s) => s.id)).toEqual(["a", "c", "b"]);
    expect(deriveInverseOp(before, op)).toEqual([
      {
        op: "delete-slide",
        slideId: "c",
      },
    ]);
    expectRoundTrip(before, op);
  });

  it("add-slide on an empty deck opts into preserving empty on persisted undo", () => {
    const before = deck([]);
    const op: PatchDeckOp = {
      op: "add-slide",
      slideId: "first",
      fields: { content: "<div>first</div>" },
    };
    expect(deriveInverseOp(before, op)).toEqual([
      {
        op: "delete-slide",
        slideId: "first",
        allowEmpty: true,
      },
    ]);
    expectRoundTrip(before, op);
  });

  it("delete-slide: inverse re-adds the full slide at its prior position", () => {
    const before = deck([
      slide("a"),
      slide("b", { content: "<div>keep me</div>", notes: "notes-b" }),
      slide("c"),
    ]);
    const op: PatchDeckOp = { op: "delete-slide", slideId: "b" };
    const after = applyOpToDeck(before, op);
    expect(after.slides.map((s) => s.id)).toEqual(["a", "c"]);
    const inverse = deriveInverseOp(before, op);
    // Inverse is [add-slide (after "a"), reorder to prior order].
    expect(inverse?.[0]).toMatchObject({
      op: "add-slide",
      slideId: "b",
      afterSlideId: "a",
      fields: { content: "<div>keep me</div>", notes: "notes-b" },
    });
    expect(inverse?.[1]).toMatchObject({ op: "reorder-slides" });
    expectRoundTrip(before, op);
  });

  it("delete-slide of the first slide re-adds at the head on undo", () => {
    const before = deck([slide("a"), slide("b")]);
    const op: PatchDeckOp = { op: "delete-slide", slideId: "a" };
    const inverse = deriveInverseOp(before, op);
    // The add-slide alone can't target the head, so the inverse includes a
    // reorder that guarantees "a" lands back at index 0.
    expect(inverse?.[0]).toMatchObject({ op: "add-slide", slideId: "a" });
    const after = applyOpToDeck(before, op);
    let restored = after;
    for (const inv of inverse!) restored = applyOpToDeck(restored, inv);
    expect(restored.slides.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("delete-slide does NOT inject a fallback blank slide (exact restore)", () => {
    const before = deck([slide("only")]);
    const after = applyOpToDeck(before, {
      op: "delete-slide",
      slideId: "only",
    });
    // Unlike the user-facing delete + server merge, the undo-apply path leaves
    // the deck genuinely empty so undoing an add on a freshly-empty deck works.
    expect(after.slides).toEqual([]);
  });

  it("reorder-slides: inverse restores the prior order", () => {
    const before = deck([slide("a"), slide("b"), slide("c")]);
    const op: PatchDeckOp = {
      op: "reorder-slides",
      orderedIds: ["c", "a", "b"],
    };
    const after = applyOpToDeck(before, op);
    expect(after.slides.map((s) => s.id)).toEqual(["c", "a", "b"]);
    expect(deriveInverseOp(before, op)).toEqual([
      {
        op: "reorder-slides",
        orderedIds: ["a", "b", "c"],
      },
    ]);
    expectRoundTrip(before, op);
  });

  it("reorder-slides keeps slides added concurrently (not in orderedIds)", () => {
    const before = deck([slide("a"), slide("b"), slide("concurrent")]);
    const op: PatchDeckOp = {
      op: "reorder-slides",
      orderedIds: ["b", "a"], // concurrent add not named
    };
    const after = applyOpToDeck(before, op);
    // The unnamed concurrent slide is preserved at the end.
    expect(after.slides.map((s) => s.id)).toEqual(["b", "a", "concurrent"]);
  });

  it("patch-deck-fields: inverse restores prior deck fields", () => {
    const before = deck([slide("a")], { title: "Old title" });
    const op: PatchDeckOp = {
      op: "patch-deck-fields",
      fields: { title: "New title" },
    };
    const after = applyOpToDeck(before, op);
    expect(after.title).toBe("New title");
    expect(deriveInverseOp(before, op)).toEqual([
      {
        op: "patch-deck-fields",
        fields: { title: "Old title" },
      },
    ]);
    expectRoundTrip(before, op);
  });

  it("applying an add-slide that already exists is idempotent", () => {
    const before = deck([slide("a")]);
    const op: PatchDeckOp = {
      op: "add-slide",
      slideId: "a",
      fields: { content: "<div>dup</div>" },
    };
    expect(applyOpToDeck(before, op)).toBe(before);
  });
});
