import { describe, expect, it, vi, beforeEach } from "vitest";

import { buildSourceImportMetadata } from "../server/lib/source-import.js";
import {
  applyOperation,
  assertPatchedSlideAnimationsResolve,
  assertSourceImportOperationsPreserved,
  assertSourceImportSlidesCovered,
  clearOmittedAnimationsForAgentContentPatches,
  isAgentPatchCaller,
  OperationSchema,
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
// run() integration mocks — DB, access, notify, and fit-check. Mirrors the
// mock shape in update-slide.test.ts so the two suites stay comparable.
// ---------------------------------------------------------------------------
const mockAssertAccess = vi.fn();
const mockNotifyClients = vi.fn();
// Keyed by slideId so a multi-slide patch-deck batch can drive a different
// fit result per slide, unlike update-slide/add-slide's single shared value.
let mockFitCheckResults: Record<
  string,
  { status: "fits" | "overflows" | "timeout"; measurement?: any }
> = {};
const mockAwaitLayoutFitCheck = vi.fn(async (slideId: string) => {
  return mockFitCheckResults[slideId] ?? { status: "timeout" };
});

let mockDeckRow: Record<string, unknown> | undefined;
const mockGetGenerationCreativeContext = vi.fn(async () => null);
const mockRecordGenerationCreativeContext = vi.fn(async () => undefined);
const mockValidateGenerationCreativeContext = vi.fn(
  async (input: {
    contextPackId?: string;
    contextModeOverride?: "off";
    reuseLabels?: Array<Record<string, unknown>>;
  }) => ({
    contextMode: input.contextModeOverride === "off" ? "off" : "auto",
    contextPackId:
      input.contextModeOverride === "off"
        ? null
        : (input.contextPackId ?? null),
    reuseLabels: input.reuseLabels ?? [],
    results: [],
  }),
);

// Minimal Drizzle query-builder stub — same surface update-slide.test.ts uses.
const mockDb = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => (mockDeckRow ? [mockDeckRow] : []),
      }),
    }),
  }),
  update: () => ({
    set: () => ({ where: async () => ({ rowsAffected: 1 }) }),
  }),
  transaction: async (callback: (tx: any) => Promise<unknown>) =>
    callback(mockDb),
};

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    decks: {
      id: "decks.id",
      title: "decks.title",
      data: "decks.data",
      designSystemId: "decks.designSystemId",
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ eq: args }),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("@agent-native/creative-context/server", () => ({
  getGenerationCreativeContext: (...args: unknown[]) =>
    mockGetGenerationCreativeContext(...args),
  recordGenerationCreativeContext: (...args: unknown[]) =>
    mockRecordGenerationCreativeContext(...args),
  validateGenerationCreativeContext: (...args: unknown[]) =>
    mockValidateGenerationCreativeContext(...args),
  mergeCreativeContextReuseLabels: (
    previous: Array<Record<string, unknown>>,
    next: Array<Record<string, unknown>>,
  ) => [...previous, ...next],
  replaceCreativeContextElementProvenance: (
    previous: Array<{ elementId: string }>,
    next: Array<{ elementId: string }>,
  ) => {
    const replaced = new Set(next.map((entry) => entry.elementId));
    return [
      ...previous.filter((entry) => !replaced.has(entry.elementId)),
      ...next,
    ];
  },
}));

vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: (...args: unknown[]) => mockNotifyClients(...args),
}));

vi.mock("./_await-fit-check.js", () => ({
  awaitLayoutFitCheck: (...args: [string, ...unknown[]]) =>
    mockAwaitLayoutFitCheck(...args),
  formatOverflowForTool: (
    deckId: string,
    m: { slideId: string; verticalOverflow: number },
  ) => `MOCK_OVERFLOW_MESSAGE deck=${deckId} slide=${m.slideId}`,
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

  it("keeps transition, animations, and image data on a duplicated slide", () => {
    const deck = { slides: [{ id: "s1", content: "1" }] };
    applyOperation(deck, {
      op: "add-slide",
      slideId: "s2",
      afterSlideId: "s1",
      fields: {
        content: "<p>Copy</p>",
        transition: "fade",
        animations: [{ id: "a1", elementIndex: 0, type: "fade" }],
        imageUrl: "https://example.com/slide.png",
        imageLoading: true,
      },
    });
    const copy = deck.slides[1];
    expect(copy.transition).toBe("fade");
    expect(copy.animations).toHaveLength(1);
    expect(copy.imageUrl).toBe("https://example.com/slide.png");
    expect(copy.imageLoading).toBeUndefined();
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

  it("rejects elementIndex-only targets when an agent revises animations", () => {
    expect(() =>
      assertPatchedSlideAnimationsResolve(
        {
          slides: [
            {
              id: "s1",
              content,
              animations: [
                {
                  id: "legacy-target",
                  elementIndex: 0,
                  type: "fade" as const,
                },
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
                {
                  id: "legacy-target",
                  elementIndex: 0,
                  type: "fade",
                },
              ],
            },
          },
        ],
        { requireElementPaths: true },
      ),
    ).toThrow(/legacy-target.*missing elementPath/);
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

  it("clears omitted animations when an agent revises slide content", () => {
    const deck = {
      slides: [{ id: "s1", content, animations: [animation()] }],
    };
    const operations: Operation[] = [
      {
        op: "patch-slide",
        slideId: "s1",
        fields: { content: '<div class="fmd-slide"><div>New</div></div>' },
      },
    ];

    for (const operation of operations) applyOperation(deck, operation);
    clearOmittedAnimationsForAgentContentPatches(deck, operations);

    expect(deck.slides[0].animations).toBeUndefined();
  });

  it("preserves imported animations for source-preserving content patches", () => {
    const sourceImport = buildSourceImportMetadata({
      format: "pptx",
      slides: [
        {
          id: "s1",
          text: "Imported slide text",
          notes: "",
          imageUrls: [],
          editableText: true,
        },
      ],
    });
    const animations = [animation()];
    const deck = {
      sourceImport,
      slides: [{ id: "s1", content, animations }],
    };
    const operations: Operation[] = [
      {
        op: "patch-slide",
        slideId: "s1",
        fields: { content },
      },
    ];

    for (const operation of operations) applyOperation(deck, operation);
    clearOmittedAnimationsForAgentContentPatches(deck, operations, {
      sourceImport,
    });

    expect(deck.slides[0].animations).toEqual(animations);
  });

  it("does not clear a separate explicit animation patch", () => {
    const animations = [animation()];
    const deck = {
      slides: [{ id: "s1", content, animations }],
    };
    const operations: Operation[] = [
      {
        op: "patch-slide",
        slideId: "s1",
        fields: { content: '<div class="fmd-slide"><div>New</div></div>' },
      },
      {
        op: "patch-slide",
        slideId: "s1",
        fields: { animations },
      },
    ];

    for (const operation of operations) applyOperation(deck, operation);
    clearOmittedAnimationsForAgentContentPatches(deck, operations);

    expect(deck.slides[0].animations).toEqual(animations);
  });

  it("keeps an explicit complete animation list with revised content", () => {
    const nextContent =
      '<div class="fmd-slide"><div><h2>New title</h2></div></div>';
    const nextAnimations = [animation({ elementPath: [0, 0] })];
    const deck = {
      slides: [{ id: "s1", content, animations: [animation()] }],
    };
    const operations: Operation[] = [
      {
        op: "patch-slide",
        slideId: "s1",
        fields: { content: nextContent, animations: nextAnimations },
      },
    ];

    for (const operation of operations) applyOperation(deck, operation);
    clearOmittedAnimationsForAgentContentPatches(deck, operations);

    expect(deck.slides[0].animations).toEqual(nextAnimations);
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

  // An untyped `animations` array sends callers probing a live deck to learn
  // the shape, and hides that the field is a whole-list replacement.
  it("spells out the animation entry shape and its replace semantics", () => {
    const parameters = patchDeckAction.tool.parameters as any;
    const slidePatch = parameters.properties.operations.items.anyOf.find(
      (operation: any) => operation.properties?.op?.const === "patch-slide",
    );
    const animations = slidePatch.properties.fields.properties.animations;

    expect(animations.description).toMatch(/complete ordered/i);
    expect(animations.items.properties.type.enum).toEqual([
      "appear",
      "fade",
      "slide-up",
      "zoom",
    ]);
    expect(animations.items.properties).toHaveProperty("id");
    expect(animations.items.properties).toHaveProperty("elementIndex");
    expect(animations.items.properties).toHaveProperty("elementPath");
  });

  // Pins the compatibility boundary rather than endorsing it. The editor
  // re-sends a slide's whole stored array on every animation edit, and
  // `normalizeSlideAnimation` in shared/api.ts still reads entries that this
  // schema rejects, so a deck holding one can no longer be saved from the
  // panel. If that gap is ever closed, this expectation is what changes.
  it("rejects stored entries that predate the required id/elementIndex/type", () => {
    const pathOnlyEntry = OperationSchema.safeParse({
      op: "patch-slide",
      slideId: "s1",
      fields: { animations: [{ elementPath: [0, 2], type: "fade" }] },
    });
    const fullyFormedEntry = OperationSchema.safeParse({
      op: "patch-slide",
      slideId: "s1",
      fields: {
        animations: [
          { id: "a1", elementIndex: 2, elementPath: [0, 2], type: "fade" },
        ],
      },
    });

    expect(pathOnlyEntry.success).toBe(false);
    expect(fullyFormedEntry.success).toBe(true);
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

// ---------------------------------------------------------------------------
// run() — layout fit re-check after a patch-deck write.
//
// update-slide and add-slide both re-measure the slide they just wrote and
// surface `layoutOverflow` when the new HTML still overflows (see
// update-slide.test.ts's "returns layoutOverflow + auto-fix message" test).
// patch-deck committed and returned `{ ok: true }` unconditionally, with no
// fit signal at all — a caller following the multi-slide repair path had no
// way to tell a persisted write from an actual repair.
// ---------------------------------------------------------------------------
describe("run() — layout fit re-check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFitCheckResults = {};
    mockDeckRow = {
      id: "deck-1",
      title: "Deck",
      designSystemId: null,
      data: JSON.stringify({
        title: "Deck",
        updatedAt: "2026-01-01T00:00:00.000Z",
        slides: [
          { id: "slide-1", content: "<div>One</div>" },
          { id: "slide-2", content: "<div>Two</div>" },
        ],
      }),
    };
  });

  it("returns layoutOverflow + message when a patched slide still overflows", async () => {
    mockFitCheckResults["slide-1"] = {
      status: "overflows",
      measurement: {
        slideId: "slide-1",
        contentHeight: 700,
        viewportHeight: 420,
        verticalOverflow: 280,
        measuredAt: Date.now(),
      },
    };

    const result = (await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: "<div>Still too tall</div>" },
          },
        ],
      },
      {},
    )) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(result.layoutOverflow).toMatchObject({
      overflows: [
        expect.objectContaining({
          slideId: "slide-1",
          verticalOverflow: 280,
        }),
      ],
    });
    expect(result.message).toMatch(/MOCK_OVERFLOW_MESSAGE.*slide-1/);
  });

  it("checks every content-changed slide in parallel, not serially", async () => {
    mockFitCheckResults["slide-1"] = {
      status: "overflows",
      measurement: {
        slideId: "slide-1",
        contentHeight: 700,
        viewportHeight: 420,
        verticalOverflow: 280,
        measuredAt: Date.now(),
      },
    };
    mockFitCheckResults["slide-2"] = {
      status: "overflows",
      measurement: {
        slideId: "slide-2",
        contentHeight: 600,
        viewportHeight: 420,
        verticalOverflow: 180,
        measuredAt: Date.now(),
      },
    };

    const result = (await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: "<div>Still too tall</div>" },
          },
          {
            op: "patch-slide",
            slideId: "slide-2",
            fields: { content: "<div>Also too tall</div>" },
          },
        ],
      },
      {},
    )) as Record<string, unknown>;

    // Both slides were checked, and neither call awaited the other: the
    // mock is synchronous, so serial awaiting vs. Promise.all is only
    // observable through the call count / result shape, not timing here.
    expect(mockAwaitLayoutFitCheck).toHaveBeenCalledTimes(2);
    expect(
      (
        result.layoutOverflow as { overflows: Array<{ slideId: string }> }
      ).overflows.map((o) => o.slideId),
    ).toEqual(["slide-1", "slide-2"]);
  });

  it("omits layoutOverflow when every changed slide fits", async () => {
    mockFitCheckResults["slide-1"] = {
      status: "fits",
      measurement: {
        slideId: "slide-1",
        contentHeight: 380,
        viewportHeight: 420,
        verticalOverflow: 0,
        measuredAt: Date.now(),
      },
    };

    const result = (await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: "<div>Now fits</div>" },
          },
        ],
      },
      {},
    )) as Record<string, unknown>;

    expect(result).toEqual({
      ok: true,
      deckId: "deck-1",
      updatedAt: expect.any(String),
      updatedSlideIds: ["slide-1"],
    });
    expect(result.layoutOverflow).toBeUndefined();
    expect(result.message).toBeUndefined();
  });

  it("omits layoutOverflow on fit-check timeout (no open editor)", async () => {
    mockFitCheckResults = {};

    const result = (await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: "<div>Headless</div>" },
          },
        ],
      },
      {},
    )) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(result.layoutOverflow).toBeUndefined();
  });

  it("does not fit-check a slide whose patch didn't touch content", async () => {
    mockFitCheckResults["slide-1"] = {
      status: "overflows",
      measurement: {
        slideId: "slide-1",
        contentHeight: 700,
        viewportHeight: 420,
        verticalOverflow: 280,
        measuredAt: Date.now(),
      },
    };

    const result = (await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          { op: "patch-slide", slideId: "slide-1", fields: { notes: "n" } },
        ],
      },
      {},
    )) as Record<string, unknown>;

    expect(mockAwaitLayoutFitCheck).not.toHaveBeenCalled();
    expect(result.layoutOverflow).toBeUndefined();
  });
});
