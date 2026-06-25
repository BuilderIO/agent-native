import { describe, expect, it, vi, beforeEach } from "vitest";

import { applyOperation, withDeckLock, type Operation } from "./patch-deck";

// ---------------------------------------------------------------------------
// normalizeSlidePadding is a pass-through in tests
// ---------------------------------------------------------------------------
vi.mock("../app/lib/normalize-slide-padding.js", () => ({
  normalizeSlidePadding: (html: string) => html,
}));

// ---------------------------------------------------------------------------
// applyOperation unit tests (pure merge logic, no DB)
// ---------------------------------------------------------------------------

describe("applyOperation — patch-slide", () => {
  it("updates only the specified fields of a slide", () => {
    const deck = {
      slides: [
        { id: "s1", content: "<p>Old</p>", notes: "note", layout: "content" },
        { id: "s2", content: "<p>Two</p>", notes: "", layout: "content" },
      ],
    };
    const op: Operation = {
      op: "patch-slide",
      slideId: "s1",
      fields: { content: "<p>New</p>" },
    };
    applyOperation(deck, op);
    expect(deck.slides[0].content).toBe("<p>New</p>");
    expect(deck.slides[0].notes).toBe("note"); // unchanged
    expect(deck.slides[1].content).toBe("<p>Two</p>"); // unchanged
  });

  it("ignores the op when the slide has been concurrently deleted", () => {
    const deck = { slides: [{ id: "s2", content: "<p>Two</p>" }] };
    const op: Operation = {
      op: "patch-slide",
      slideId: "s1",
      fields: { content: "<p>New</p>" },
    };
    // Must not throw
    applyOperation(deck, op);
    expect(deck.slides).toHaveLength(1);
  });

  it("concurrent patches to different slides both survive", () => {
    const deck = {
      slides: [
        { id: "s1", content: "<p>Slide1</p>" },
        { id: "s2", content: "<p>Slide2</p>" },
      ],
    };
    const op1: Operation = {
      op: "patch-slide",
      slideId: "s1",
      fields: { content: "<p>Updated1</p>" },
    };
    const op2: Operation = {
      op: "patch-slide",
      slideId: "s2",
      fields: { content: "<p>Updated2</p>" },
    };
    // Simulate two independent writes applied sequentially (as the lock serialises them)
    applyOperation(deck, op1);
    applyOperation(deck, op2);
    expect(deck.slides[0].content).toBe("<p>Updated1</p>");
    expect(deck.slides[1].content).toBe("<p>Updated2</p>");
  });
});

describe("applyOperation — delete-slide", () => {
  it("removes the targeted slide", () => {
    const deck = {
      slides: [
        { id: "s1", content: "<p>One</p>" },
        { id: "s2", content: "<p>Two</p>" },
      ],
    };
    applyOperation(deck, { op: "delete-slide", slideId: "s1" });
    expect(deck.slides).toHaveLength(1);
    expect(deck.slides[0].id).toBe("s2");
  });

  it("inserts a blank fallback slide when the last slide is deleted", () => {
    const deck = { slides: [{ id: "s1", content: "<p>Only</p>" }] };
    applyOperation(deck, { op: "delete-slide", slideId: "s1" });
    expect(deck.slides).toHaveLength(1);
    expect(deck.slides[0].layout).toBe("blank");
  });

  it("is a no-op when the slide was already deleted (idempotent)", () => {
    const deck = { slides: [{ id: "s2", content: "<p>Two</p>" }] };
    applyOperation(deck, { op: "delete-slide", slideId: "s1" });
    expect(deck.slides).toHaveLength(1);
  });
});

describe("applyOperation — reorder-slides", () => {
  it("reorders slides to match orderedIds", () => {
    const deck = {
      slides: [
        { id: "s1", content: "1" },
        { id: "s2", content: "2" },
        { id: "s3", content: "3" },
      ],
    };
    applyOperation(deck, {
      op: "reorder-slides",
      orderedIds: ["s3", "s1", "s2"],
    });
    expect(deck.slides.map((s: { id: string }) => s.id)).toEqual([
      "s3",
      "s1",
      "s2",
    ]);
  });

  it("keeps slides not in orderedIds at the end (concurrent add safety)", () => {
    const deck = {
      slides: [
        { id: "s1", content: "1" },
        { id: "s2", content: "2" },
        { id: "s3-new", content: "3" }, // added concurrently, not in client list
      ],
    };
    applyOperation(deck, {
      op: "reorder-slides",
      orderedIds: ["s2", "s1"],
    });
    expect(deck.slides.map((s: { id: string }) => s.id)).toEqual([
      "s2",
      "s1",
      "s3-new",
    ]);
  });

  it("reorder during concurrent add does not drop the new slide", () => {
    // Simulate: writer A reorders [s2, s1], writer B concurrently added s3.
    // The lock means they execute sequentially. Writer A's reorder runs first,
    // then writer B's add-slide. But even if the reorder ran on the state
    // BEFORE s3 existed, the "append unknowns" rule saves s3.
    const deckAfterAdd = {
      slides: [
        { id: "s1", content: "1" },
        { id: "s2", content: "2" },
        { id: "s3", content: "3" }, // added by writer B
      ],
    };
    // Writer A's reorder only knew about s1 and s2
    applyOperation(deckAfterAdd, {
      op: "reorder-slides",
      orderedIds: ["s2", "s1"],
    });
    const ids = deckAfterAdd.slides.map((s: { id: string }) => s.id);
    expect(ids).toContain("s3");
    expect(ids).toEqual(["s2", "s1", "s3"]);
  });
});

describe("applyOperation — add-slide", () => {
  it("appends the slide when no afterSlideId is given", () => {
    const deck = { slides: [{ id: "s1", content: "1" }] };
    applyOperation(deck, {
      op: "add-slide",
      slideId: "s2",
      fields: {
        content: "<p>New</p>",
        layout: "content",
        background: "bg-black",
      },
    });
    expect(deck.slides).toHaveLength(2);
    expect(deck.slides[1].id).toBe("s2");
  });

  it("inserts after the referenced slide", () => {
    const deck = {
      slides: [
        { id: "s1", content: "1" },
        { id: "s3", content: "3" },
      ],
    };
    applyOperation(deck, {
      op: "add-slide",
      slideId: "s2",
      afterSlideId: "s1",
      fields: { content: "<p>Two</p>" },
    });
    expect(deck.slides.map((s: { id: string }) => s.id)).toEqual([
      "s1",
      "s2",
      "s3",
    ]);
  });

  it("is idempotent — duplicate delivery is silently ignored", () => {
    const deck = {
      slides: [
        { id: "s1", content: "1" },
        { id: "s2", content: "existing" },
      ],
    };
    applyOperation(deck, {
      op: "add-slide",
      slideId: "s2",
      fields: { content: "<p>New</p>" },
    });
    expect(deck.slides).toHaveLength(2);
    expect(deck.slides[1].content).toBe("existing"); // not overwritten
  });
});

describe("applyOperation — patch-deck-fields", () => {
  it("updates only the provided top-level fields", () => {
    const deck = {
      title: "Old",
      designSystemId: "ds1",
      tweaks: { accent: "#f00" },
      slides: [],
    };
    applyOperation(deck, {
      op: "patch-deck-fields",
      fields: { title: "New" },
    });
    expect(deck.title).toBe("New");
    expect(deck.designSystemId).toBe("ds1"); // unchanged
  });

  it("allows clearing designSystemId to null", () => {
    const deck = { title: "T", designSystemId: "ds1", slides: [] };
    applyOperation(deck, {
      op: "patch-deck-fields",
      fields: { designSystemId: null },
    });
    expect(deck.designSystemId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// withDeckLock serialisation test
// ---------------------------------------------------------------------------

describe("withDeckLock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serialises concurrent writes for the same deck", async () => {
    const order: string[] = [];
    let resolveFirst!: () => void;
    const firstDone = new Promise<void>((res) => {
      resolveFirst = res;
    });

    const first = withDeckLock("deck-x", async () => {
      order.push("first-start");
      await firstDone;
      order.push("first-end");
    });

    const second = withDeckLock("deck-x", async () => {
      order.push("second-start");
    });

    resolveFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("allows concurrent writes for DIFFERENT decks", async () => {
    const order: string[] = [];
    let resolveA!: () => void;
    const aDone = new Promise<void>((res) => {
      resolveA = res;
    });

    const a = withDeckLock("deck-a", async () => {
      order.push("a-start");
      await aDone;
      order.push("a-end");
    });

    const b = withDeckLock("deck-b", async () => {
      order.push("b-start");
    });

    await b; // deck-b finishes immediately while deck-a is still waiting
    expect(order).toContain("b-start");
    expect(order).not.toContain("a-end");

    resolveA();
    await a;
    expect(order).toContain("a-end");
  });
});
