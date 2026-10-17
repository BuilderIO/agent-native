import { describe, expect, it } from "vitest";

import addSlide from "./add-slide.js";
import getDeck from "./get-deck.js";
import patchDeck from "./patch-deck.js";
import updateSlide from "./update-slide.js";

type RetrySafe = (input: unknown) => boolean;

function retrySafeOf(action: { retrySafe?: unknown }): RetrySafe {
  if (typeof action.retrySafe !== "function") {
    throw new Error("expected a retrySafe predicate");
  }
  return action.retrySafe as RetrySafe;
}

describe("get-deck retry safety", () => {
  it("is retry-safe because its only write is an idempotent duplicate-id repair", () => {
    expect(getDeck.retrySafe).toBe(true);
    expect(getDeck.readOnly).toBe(false);
  });
});

describe("update-slide retry safety", () => {
  const retrySafe = retrySafeOf(updateSlide);

  it("is retry-safe for every input mode that carries a source hash", () => {
    expect(
      retrySafe({
        deckId: "deck-1",
        slideId: "slide-1",
        edits: [{ find: "color: red", replace: "color: blue", occurrence: 2 }],
        baseContentHash: "hash-1",
      }),
    ).toBe(true);
    expect(
      retrySafe({
        deckId: "deck-1",
        slideId: "slide-1",
        fullContent: '<div class="fmd-slide"></div>',
        baseContentHash: "hash-1",
      }),
    ).toBe(true);
    expect(
      retrySafe({
        deckId: "deck-1",
        slideId: "slide-1",
        objectId: "title",
        replace: "Hello",
        baseContentHash: "hash-1",
      }),
    ).toBe(true);
  });

  it("stays blocked for hash-less search-and-replace, which can re-apply", () => {
    expect(
      retrySafe({
        deckId: "deck-1",
        slideId: "slide-1",
        edits: [{ find: "color: red", replace: "color: blue", occurrence: 2 }],
      }),
    ).toBe(false);
    expect(
      retrySafe({
        deckId: "deck-1",
        slideId: "slide-1",
        find: "Draft",
        replace: "Final",
      }),
    ).toBe(false);
  });
});

describe("patch-deck retry safety", () => {
  const retrySafe = retrySafeOf(patchDeck);

  it("is retry-safe for content patches only when each carries its own hash", () => {
    expect(
      retrySafe({
        deckId: "deck-1",
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: {},
            edits: [{ find: "red", replace: "blue", occurrence: 1 }],
            baseContentHash: "hash-1",
          },
        ],
      }),
    ).toBe(true);
    expect(
      retrySafe({
        deckId: "deck-1",
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: {},
            edits: [{ find: "red", replace: "blue", occurrence: 1 }],
          },
        ],
      }),
    ).toBe(false);
    expect(
      retrySafe({
        deckId: "deck-1",
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: "<div></div>" },
            baseContentHash: "hash-1",
          },
        ],
      }),
    ).toBe(true);
  });

  it("is retry-safe for operations that set end state by id", () => {
    expect(
      retrySafe({
        deckId: "deck-1",
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { background: "#fff" },
          },
          { op: "add-slide", slideId: "slide-2", fields: { content: "<p/>" } },
          { op: "delete-slide", slideId: "slide-3" },
          { op: "reorder-slides", orderedIds: ["slide-1", "slide-2"] },
          { op: "patch-deck-fields", fields: { title: "Q3 review" } },
        ],
      }),
    ).toBe(true);
  });

  it("blocks the whole batch when any one operation is unsafe", () => {
    expect(
      retrySafe({
        deckId: "deck-1",
        operations: [
          { op: "reorder-slides", orderedIds: ["slide-1"] },
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: {},
            edits: [{ find: "red", replace: "blue" }],
          },
        ],
      }),
    ).toBe(false);
  });

  it("blocks malformed input and an add-slide without a slide id", () => {
    expect(retrySafe({ deckId: "deck-1" })).toBe(false);
    expect(
      retrySafe({
        deckId: "deck-1",
        operations: [{ op: "add-slide", fields: { content: "<p/>" } }],
      }),
    ).toBe(false);
  });
});

describe("add-slide retry safety", () => {
  it("stays undeclared because a replay with the same slideId still appends a copy", () => {
    expect(addSlide.retrySafe).toBeUndefined();
  });
});
