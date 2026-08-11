import { describe, expect, it, vi, beforeEach } from "vitest";

import { buildSourceImportMetadata } from "../server/lib/source-import.js";
import {
  applyOperation,
  assertPatchedSlideAnimationsResolve,
  assertSourceImportOperationsPreserved,
  assertSourceImportSlidesCovered,
  isAgentPatchCaller,
  resolveDeckColumnUpdates,
  withDeckLock,
  type Operation,
} from "./patch-deck";
import patchDeckAction from "./patch-deck";

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

  it("can preserve an empty deck when undoing an add-slide", () => {
    const deck = { slides: [{ id: "s1", content: "<p>Only</p>" }] };
    applyOperation(deck, {
      op: "delete-slide",
      slideId: "s1",
      allowEmpty: true,
    });
    expect(deck.slides).toEqual([]);
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

  it("recovers an opaque title from the first slide", () => {
    const deck = {
      title: "Untitled Deck",
      slides: [
        {
          content:
            '<div class="fmd-slide"><div style="font-size: 54px;">Agent-Native Strategy</div></div>',
        },
      ],
    };

    applyOperation(deck, {
      op: "patch-deck-fields",
      fields: { title: "H3sVsnns-TEVUOpz9w" },
    });

    expect(deck.title).toBe("Agent-Native Strategy");
  });

  it("rejects an opaque title when no slide title is available", () => {
    expect(() =>
      applyOperation(
        { title: "Untitled Deck", slides: [] },
        {
          op: "patch-deck-fields",
          fields: { title: "H3sVsnns-TEVUOpz9w" },
        },
      ),
    ).toThrow(/human-readable title/);
  });
});

describe("source-imported deck structure", () => {
  const metadata = buildSourceImportMetadata({
    format: "pdf",
    slides: [],
  });

  it("rejects structural operations while source preservation is enabled", () => {
    expect(() =>
      assertSourceImportOperationsPreserved(metadata, [
        { op: "add-slide", slideId: "s2", fields: { content: "New" } },
      ]),
    ).toThrow("source-imported deck");
  });

  it("allows structural operations for a regular deck", () => {
    expect(() =>
      assertSourceImportOperationsPreserved(null, [
        { op: "delete-slide", slideId: "s1" },
      ]),
    ).not.toThrow();
  });

  it("rejects a partial deck-wide source restyle before writing", () => {
    const metadata = buildSourceImportMetadata({
      format: "pdf",
      slides: [
        { id: "s1", text: "one", notes: "", imageUrls: [], editableText: true },
        { id: "s2", text: "two", notes: "", imageUrls: [], editableText: true },
        {
          id: "s3",
          text: "three",
          notes: "",
          imageUrls: [],
          editableText: true,
        },
      ],
    });

    expect(() =>
      assertSourceImportSlidesCovered(
        metadata,
        [{ op: "patch-slide", slideId: "s1", fields: { content: "styled" } }],
        true,
      ),
    ).toThrow("Missing 2 slide(s): s2, s3");
  });

  it("accepts complete content coverage for a deck-wide source restyle", () => {
    const metadata = buildSourceImportMetadata({
      format: "pdf",
      slides: [
        { id: "s1", text: "one", notes: "", imageUrls: [], editableText: true },
        { id: "s2", text: "two", notes: "", imageUrls: [], editableText: true },
      ],
    });

    expect(() =>
      assertSourceImportSlidesCovered(
        metadata,
        [
          { op: "patch-slide", slideId: "s1", fields: { content: "one" } },
          { op: "patch-slide", slideId: "s2", fields: { content: "two" } },
        ],
        true,
      ),
    ).not.toThrow();
  });
});

describe("animation target validation", () => {
  const content = `<div class="fmd-slide">
    <div><h2>Title</h2></div>
    <div><p>Body</p></div>
  </div>`;

  const animation = (overrides: Record<string, unknown> = {}) => ({
    id: "reveal-title",
    elementIndex: 0,
    elementPath: [0, 0],
    type: "fade" as const,
    ...overrides,
  });

  const applyAndValidate = (deck: any, operations: Operation[]) => {
    for (const operation of operations) {
      applyOperation(deck, operation);
    }
    assertPatchedSlideAnimationsResolve(deck, operations);
  };

  it("accepts paths that resolve in the final slide HTML", () => {
    expect(() =>
      applyAndValidate(
        {
          slides: [{ id: "s1", content, animations: [animation()] }],
        },
        [
          {
            op: "patch-slide",
            slideId: "s1",
            fields: { content, animations: [animation()] },
          },
        ],
      ),
    ).not.toThrow();
  });

  it("rejects a stale path before persistence can accept it", () => {
    expect(() =>
      applyAndValidate(
        {
          slides: [
            {
              id: "s1",
              content,
              animations: [animation({ elementPath: [9, 9] })],
            },
          ],
        },
        [
          {
            op: "patch-slide",
            slideId: "s1",
            fields: {
              content,
              animations: [animation({ elementPath: [9, 9] })],
            },
          },
        ],
      ),
    ).toThrow(/reveal-title.*does not resolve/);
  });

  it("rejects duplicate reveal targets instead of creating a phantom step", () => {
    expect(() =>
      applyAndValidate(
        {
          slides: [
            {
              id: "s1",
              content,
              animations: [
                animation(),
                animation({ id: "reveal-title-again" }),
              ],
            },
          ],
        },
        [
          {
            op: "patch-slide",
            slideId: "s1",
            fields: {
              animations: [
                animation(),
                animation({ id: "reveal-title-again" }),
              ],
            },
          },
        ],
      ),
    ).toThrow(/reveal-title-again.*duplicates target path 0.0/);
  });

  it("does not validate stale animation metadata for unrelated writes", () => {
    expect(() =>
      applyAndValidate(
        {
          slides: [
            {
              id: "s1",
              content,
              animations: [animation({ elementPath: [99] })],
            },
          ],
        },
        [{ op: "patch-slide", slideId: "s1", fields: { notes: "Updated" } }],
      ),
    ).not.toThrow();
  });
});

describe("isAgentPatchCaller", () => {
  it("treats tool, mcp, and a2a callers as agent callers", () => {
    expect(isAgentPatchCaller("tool")).toBe(true);
    expect(isAgentPatchCaller("mcp")).toBe(true);
    expect(isAgentPatchCaller("a2a")).toBe(true);
  });

  it("treats the browser editor and unset callers as non-agent", () => {
    expect(isAgentPatchCaller("frontend")).toBe(false);
    expect(isAgentPatchCaller("http")).toBe(false);
    expect(isAgentPatchCaller(undefined)).toBe(false);
  });
});

describe("patch-deck agent schema", () => {
  it("advertises only bounded deck and slide patch operations", () => {
    const parameters = patchDeckAction.tool.parameters as any;
    const operations = parameters.properties.operations.items.anyOf;
    const deckFields = operations.find(
      (operation: any) =>
        operation.properties?.op?.const === "patch-deck-fields",
    );
    const slidePatch = operations.find(
      (operation: any) => operation.properties?.op?.const === "patch-slide",
    );

    expect(operations).toHaveLength(2);
    expect(deckFields.properties.fields.properties.title).toMatchObject({
      type: "string",
    });
    expect(deckFields.properties.fields.properties).not.toHaveProperty(
      "aspectRatio",
    );
    expect(deckFields.properties.fields.properties).not.toHaveProperty(
      "visibility",
    );
    expect(slidePatch.properties.slideId).toMatchObject({ type: "string" });
    expect(slidePatch.properties.fields.properties.content).toMatchObject({
      type: "string",
    });
    expect(parameters.properties.requireAllSourceSlides).toMatchObject({
      type: "boolean",
    });
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

// ---------------------------------------------------------------------------
// resolveDeckColumnUpdates — SQL columns must match the deck JSON
// ---------------------------------------------------------------------------

describe("resolveDeckColumnUpdates", () => {
  const current = { title: "Old", designSystemId: null };

  const renameOp = (title: string): Operation => ({
    op: "patch-deck-fields",
    fields: { title },
  });

  it("takes the last title in a debounced rename burst", () => {
    // One keystroke per op — the column must land on the final value, or the
    // deck list shows a truncated name once the JSON and column disagree.
    const burst = ["N", "Ne", "New", "New ", "New Name"].map(renameOp);
    expect(resolveDeckColumnUpdates(current, burst).title).toBe("New Name");
  });

  it("uses the title recovered while applying the operations", () => {
    const operations: Operation[] = [
      {
        op: "patch-deck-fields",
        fields: { title: "H3sVsnns-TEVUOpz9w" },
      },
    ];
    expect(
      resolveDeckColumnUpdates(current, operations, "Recovered").title,
    ).toBe("Recovered");
  });

  it("takes the last designSystemId in a batch", () => {
    const ops: Operation[] = [
      { op: "patch-deck-fields", fields: { designSystemId: "ds-1" } },
      { op: "patch-deck-fields", fields: { designSystemId: "ds-2" } },
    ];
    expect(resolveDeckColumnUpdates(current, ops).designSystemId).toBe("ds-2");
  });

  it("keeps current values when no field op touches them", () => {
    const ops: Operation[] = [
      { op: "delete-slide", slideId: "s1" },
      { op: "patch-deck-fields", fields: { visibility: "org" } },
    ];
    expect(
      resolveDeckColumnUpdates({ title: "Keep", designSystemId: "ds-9" }, ops),
    ).toEqual({ title: "Keep", designSystemId: "ds-9" });
  });

  it("treats an explicit null designSystemId as a clear", () => {
    const ops: Operation[] = [
      { op: "patch-deck-fields", fields: { designSystemId: null } },
    ];
    expect(
      resolveDeckColumnUpdates({ title: "T", designSystemId: "ds-1" }, ops)
        .designSystemId,
    ).toBeNull();
  });
});
