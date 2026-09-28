// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  applyOpToDeck,
  applyUndoOpToDecks,
  deriveInverseOp,
  reorderSlidesById,
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

function stripTimestamps(d: Deck): Omit<Deck, "updatedAt"> {
  const { updatedAt: _u, ...rest } = d;
  void _u;
  return rest;
}

function expectRoundTrip(before: Deck, op: PatchDeckOp) {
  const inverseOps = deriveInverseOp(before, op);
  expect(inverseOps).not.toBeNull();
  const after = applyOpToDeck(before, op);
  let restored = after;
  for (const inv of inverseOps!) {
    restored = applyOpToDeck(restored, inv);
  }
  expect(stripTimestamps(restored)).toEqual(stripTimestamps(before));
}

describe("deriveInverseOp / applyOpToDeck round-trips", () => {
  it("moves a selected slide group together while preserving its order", () => {
    const slides = [slide("a"), slide("b"), slide("c"), slide("d")];
    expect(
      reorderSlidesById(slides, "b", "d", ["b", "c"])?.map((s) => s.id),
    ).toEqual(["a", "d", "b", "c"]);
  });

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
    const before = deck([slide("a")]);
    const op: PatchDeckOp = {
      op: "patch-slide",
      slideId: "a",
      fields: { background: "bg-red" },
    };
    const inverse = deriveInverseOp(before, op);
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
    expect(applyOpToDeck(before, op)).toBe(before);
  });

  it("does not create an inverse for an unchanged slide patch", () => {
    const before = deck([
      slide("a", { content: "same", background: "bg-black" }),
    ]);
    const op: PatchDeckOp = {
      op: "patch-slide",
      slideId: "a",
      fields: { content: "same", background: "bg-black" },
    };

    expect(deriveInverseOp(before, op)).toBeNull();
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
    expect(after.slides.map((s) => s.id)).toEqual(["b", "a", "concurrent"]);
  });

  it("clears imported source provenance only for structural changes", () => {
    const before = deck([slide("a"), slide("b")], {
      sourceImport: { mode: "source-preserving" },
    });
    const contentEdit = applyOpToDeck(before, {
      op: "patch-slide",
      slideId: "a",
      fields: { content: "<div>edited</div>" },
    });
    expect(contentEdit.sourceImport).toEqual({ mode: "source-preserving" });

    const structuralOps: PatchDeckOp[] = [
      { op: "delete-slide", slideId: "a" },
      { op: "reorder-slides", orderedIds: ["b", "a"] },
      { op: "add-slide", slideId: "c", fields: { content: "<div>c</div>" } },
    ];
    for (const op of structuralOps) {
      expect(applyOpToDeck(before, op).sourceImport).toBeUndefined();
    }
  });

  it("restores imported source provenance through a replacement undo", () => {
    const before = deck([slide("a"), slide("b")], {
      sourceImport: { mode: "source-preserving", slideIds: ["a", "b"] },
    });
    const after = applyOpToDeck(before, {
      op: "delete-slide",
      slideId: "a",
    });

    expect(after.sourceImport).toBeUndefined();
    expect(
      applyUndoOpToDecks([after], {
        op: "replace-deck",
        deckId: before.id,
        deck: before,
      }),
    ).toEqual([before]);
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

  it("does not create an inverse for unchanged deck fields", () => {
    const before = deck([slide("a")], { title: "Same title" });
    const op: PatchDeckOp = {
      op: "patch-deck-fields",
      fields: { title: "Same title" },
    };

    expect(deriveInverseOp(before, op)).toBeNull();
    expect(applyOpToDeck(before, op)).toBe(before);
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
