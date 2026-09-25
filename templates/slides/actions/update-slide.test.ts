import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.fn();
const mockNotifyClients = vi.fn();
const mockGetCurrentRequestBrowserTabId = vi.fn(() => null);
const mockReadAppStateForCurrentTab = vi.fn(async () => null);

// Captured by the Drizzle `update().set()` mock so tests can assert on the
// persisted deck JSON + bumped updatedAt.
let lastUpdateSet: { data?: string; updatedAt?: string } | undefined;
let updateRowsAffected = 1;

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

// Minimal Drizzle query-builder stub. The action only uses:
//   db.select({...}).from(decks).where(...).limit(1)  -> [row]
//   db.update(decks).set({...}).where(...)            -> persists
const mockDb = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => (mockDeckRow ? [mockDeckRow] : []),
      }),
    }),
  }),
  update: () => ({
    set: (values: { data?: string; updatedAt?: string }) => {
      lastUpdateSet = values;
      return { where: async () => ({ rowsAffected: updateRowsAffected }) };
    },
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
      ownerEmail: "decks.ownerEmail",
      designSystemId: "decks.designSystemId",
      updatedAt: "decks.updatedAt",
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (...args: unknown[]) => ({ eq: args }),
  isNull: (...args: unknown[]) => ({ isNull: args }),
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: ({ params }: { params: { deckId: string } }) =>
    `/deck/${params.deckId}`,
  withConfiguredAppBasePath: (baseUrl: string) => baseUrl,
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

const mockAgentTouchDocument = vi.fn();
vi.mock("@agent-native/core/collab", () => ({
  agentTouchDocument: (...args: unknown[]) => mockAgentTouchDocument(...args),
}));

vi.mock("./_tab-state.js", () => ({
  getCurrentRequestBrowserTabId: () => mockGetCurrentRequestBrowserTabId(),
  readAppStateForCurrentTab: (...args: unknown[]) =>
    mockReadAppStateForCurrentTab(...args),
}));

// Real per-deck lock just runs the fn; passthrough keeps the unit test focused
// on update-slide's own read-modify-write logic.
vi.mock("./patch-deck.js", () => ({
  isAgentPatchCaller: (caller?: string) =>
    caller === "tool" || caller === "mcp" || caller === "a2a",
  withDeckLock: (_deckId: string, fn: () => Promise<unknown>) => fn(),
  isAgentPatchCaller: (caller: string | undefined) =>
    caller === "tool" ||
    caller === "mcp" ||
    caller === "a2a" ||
    caller === "webmcp",
}));

vi.mock("../server/lib/deck-versions.js", () => ({
  createDeckVersionSnapshot: vi.fn(async () => ({ created: true })),
  deckVersionChangeGroupFromAction: vi.fn(() => undefined),
  deckVersionChatContextFromAction: vi.fn(() => undefined),
}));

import { hashSlideContent } from "../shared/slide-fit";
import { nextDeckRevision } from "./_deck-write";
import action from "./update-slide";

beforeEach(() => {
  vi.clearAllMocks();
  lastUpdateSet = undefined;
  updateRowsAffected = 1;
  mockDeckRow = {
    id: "deck-1",
    title: "Deck",
    ownerEmail: "owner@example.com",
    updatedAt: "2026-01-01T00:00:00.000Z",
    data: JSON.stringify({
      title: "Deck",
      updatedAt: "2026-01-01T00:00:00.000Z",
      slides: [{ id: "slide-1", content: "<div>Old</div>" }],
    }),
  };
  mockGetCurrentRequestBrowserTabId.mockReturnValue(null);
  mockReadAppStateForCurrentTab.mockResolvedValue(null);
});

describe("update-slide", () => {
  it("uses a full-content repair for verified layout overflow", () => {
    expect(action.tool.description).toContain(
      "verified layout overflow: call get-deck with slideId",
    );
    expect(action.tool.description).toContain(
      "one fullContent repair with baseContentHash",
    );
  });

  it("always advances a millisecond deck revision", () => {
    const revision = "2026-01-01T00:00:00.000Z";
    expect(nextDeckRevision(revision, new Date(revision))).toBe(
      "2026-01-01T00:00:00.001Z",
    );
  });

  it("applies the edit, bumps deck updatedAt, persists, and notifies clients", async () => {
    mockDeckRow!.data = JSON.stringify({
      title: "Deck",
      updatedAt: "2026-01-01T00:00:00.000Z",
      slides: [
        {
          id: "slide-1",
          content: "<div>Old</div>",
          layoutWarningDismissed: true,
          animations: [
            {
              id: "old-reveal",
              elementIndex: 0,
              elementPath: [0],
              type: "fade",
            },
          ],
        },
      ],
    });
    const result = await action.run(
      {
        deckId: "deck-1",
        slideId: "slide-1",
        fullContent: "<div>New</div>",
      },
      { caller: "tool" },
    );

    expect(result).toMatchObject({
      ok: true,
      deckId: "deck-1",
      slideId: "slide-1",
      applied: true,
    });
    expect(mockAssertAccess).toHaveBeenCalledWith("deck", "deck-1", "editor");

    // The persisted deck JSON contains the new content and a bumped updatedAt,
    // and the row updatedAt matches the JSON updatedAt (the freshness signal
    // the open editor uses to detect a genuinely-newer external edit).
    expect(lastUpdateSet).toBeDefined();
    const deck = JSON.parse(lastUpdateSet!.data as string);
    expect(deck.slides[0].content).toBe("<div>New</div>");
    expect(deck.slides[0].layoutWarningDismissed).toBeUndefined();
    expect(deck.slides[0].animations).toBeUndefined();
    expect(deck.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
    expect(lastUpdateSet!.updatedAt).toBe(deck.updatedAt);
    // The broadcast now carries the changed slideId + agent actor (backwards-
    // compatible — { type, deckId } are still present in the wire payload).
    expect(mockNotifyClients).toHaveBeenCalledWith("deck-1", {
      slideId: "slide-1",
      actor: "agent",
    });
    // A deterministic focused edit without an existing or explicit Creative
    // Context scope must not enter the generation-context gate.
    expect(mockValidateGenerationCreativeContext).not.toHaveBeenCalled();
    expect(mockRecordGenerationCreativeContext).not.toHaveBeenCalled();
    // The agent's presence is recorded on the DECK presence doc for this slide.
    expect(mockAgentTouchDocument).toHaveBeenCalledWith(
      "deck-deck-1",
      expect.objectContaining({
        metadata: { slide: "slide-1" },
        edit: expect.objectContaining({
          descriptor: { kind: "paths", paths: ["slides.slide-1"] },
        }),
      }),
    );
  });

  it("rejects a stale browser-tab target before writing", async () => {
    mockGetCurrentRequestBrowserTabId.mockReturnValue("tab-1");
    mockReadAppStateForCurrentTab.mockResolvedValue({
      deckId: "deck-1",
      slideId: "slide-2",
      slideIndex: 1,
      items: [{ selectedText: "Old" }],
    });

    await expect(
      action.run({
        deckId: "deck-1",
        slideId: "slide-1",
        edits: [{ find: "Old", replace: "New" }],
      }),
    ).rejects.toThrow("selected Slides target is on slide slide-2");

    expect(mockReadAppStateForCurrentTab).toHaveBeenCalledWith(
      "slides-selection",
      { fallbackToGlobal: false },
    );
    expect(lastUpdateSet).toBeUndefined();
    expect(mockNotifyClients).not.toHaveBeenCalled();
  });

  it("allows an explicit named edit to a non-current slide", async () => {
    mockGetCurrentRequestBrowserTabId.mockReturnValue("tab-1");
    mockReadAppStateForCurrentTab.mockResolvedValue({
      deckId: "deck-1",
      slideId: "slide-2",
      slideIndex: 1,
      items: [{ selectedText: "Old" }],
    });

    const result = await action.run({
      deckId: "deck-1",
      slideId: "slide-1",
      edits: [{ find: "Old", replace: "New", expectedMatches: 1 }],
      baseContentHash: hashSlideContent("<div>Old</div>"),
    });

    expect(result).toMatchObject({ ok: true, applied: true });
    expect(JSON.parse(lastUpdateSet!.data as string).slides[0].content).toBe(
      "<div>New</div>",
    );
  });

  it("does not require Creative Context for an unscoped WebMCP edit", async () => {
    const result = await action.run(
      {
        deckId: "deck-1",
        slideId: "slide-1",
        edits: [{ find: "Old", replace: "New", expectedMatches: 1 }],
      },
      { caller: "webmcp" },
    );

    expect(result).toMatchObject({ ok: true, applied: true });
    expect(mockGetGenerationCreativeContext).not.toHaveBeenCalled();
    expect(mockValidateGenerationCreativeContext).not.toHaveBeenCalled();
    expect(mockRecordGenerationCreativeContext).not.toHaveBeenCalled();
  });

  it("replaces a selected object through the compact WebMCP input", async () => {
    mockDeckRow!.data = JSON.stringify({
      title: "Deck",
      updatedAt: "2026-01-01T00:00:00.000Z",
      slides: [
        {
          id: "slide-1",
          content:
            '<div class="fmd-slide"><h1 data-slide-object-id="title" style="color:red">Old</h1></div>',
        },
      ],
    });

    const result = await action.run(
      {
        deckId: "deck-1",
        slideId: "slide-1",
        objectId: "title",
        replace: "New",
      },
      { caller: "webmcp" },
    );

    expect(result).toMatchObject({ ok: true, applied: true });
    // The edit left the slide root alone, so no padding is added to it.
    expect(JSON.parse(lastUpdateSet!.data as string).slides[0].content).toBe(
      '<div class="fmd-slide"><h1 data-slide-object-id="title" style="color:red">New</h1></div>',
    );
  });

  it("refuses content that adds editor-rendered markup, but saves content that already had it", async () => {
    const stored =
      '<div class="fmd-slide" style="padding: 40px"><style>[data-slide-content-scope="slide-a"] .x { color: red; }</style><p class="x">Old</p></div>';
    mockDeckRow!.data = JSON.stringify({
      title: "Deck",
      updatedAt: "2026-01-01T00:00:00.000Z",
      slides: [{ id: "slide-1", content: stored }],
    });

    await expect(
      action.run({
        deckId: "deck-1",
        slideId: "slide-1",
        fullContent: stored.replace(
          '<p class="x">',
          '<p class="x" data-builder-id="b-1" data-src-i="slide-r1.s:3">',
        ),
      }),
    ).rejects.toMatchObject({
      errorCode: "render_artifact_in_slide_content",
      details: { markers: ["data-src-i", "data-builder-id"] },
    });
    expect(lastUpdateSet).toBeUndefined();

    const result = await action.run({
      deckId: "deck-1",
      slideId: "slide-1",
      fullContent: stored.replace("Old", "New"),
    });
    expect(result).toMatchObject({ ok: true, applied: true });
    expect(JSON.parse(lastUpdateSet!.data as string).slides[0].content).toBe(
      stored.replace("Old", "New"),
    );
  });

  it("rejects a compact object edit without an explicit replacement", async () => {
    await expect(
      action.run({
        deckId: "deck-1",
        slideId: "slide-1",
        objectId: "title",
      }),
    ).rejects.toThrow("Legacy --objectId requires --replace");

    expect(lastUpdateSet).toBeUndefined();
    expect(mockNotifyClients).not.toHaveBeenCalled();
  });

  it("rejects a legacy find edit without an explicit replacement", async () => {
    await expect(
      action.run({
        deckId: "deck-1",
        slideId: "slide-1",
        find: "Old",
      }),
    ).rejects.toThrow("Legacy --find requires --replace");

    expect(lastUpdateSet).toBeUndefined();
    expect(mockNotifyClients).not.toHaveBeenCalled();
  });

  it("preserves dismissed overflow warnings for human content edits", async () => {
    mockDeckRow!.data = JSON.stringify({
      title: "Deck",
      updatedAt: "2026-01-01T00:00:00.000Z",
      slides: [
        {
          id: "slide-1",
          content: "<div>Old</div>",
          layoutWarningDismissed: true,
        },
      ],
    });

    await action.run(
      {
        deckId: "deck-1",
        slideId: "slide-1",
        fullContent: "<div>Human edit</div>",
      },
      { caller: "frontend" },
    );

    expect(
      JSON.parse(lastUpdateSet!.data as string).slides[0]
        .layoutWarningDismissed,
    ).toBe(true);
  });

  it("applies a surgical find/replace edit", async () => {
    const result = (await action.run({
      deckId: "deck-1",
      slideId: "slide-1",
      find: "Old",
      replace: "Fresh",
    })) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    const deck = JSON.parse(lastUpdateSet!.data as string);
    expect(deck.slides[0].content).toBe("<div>Fresh</div>");
  });

  it("rejects an orphaned legacy replacement before reading or writing", async () => {
    await expect(
      action.run({
        deckId: "deck-1",
        slideId: "slide-1",
        replace: "Fresh",
      }),
    ).rejects.toThrow("Legacy --replace requires --find");

    expect(mockAssertAccess).not.toHaveBeenCalled();
    expect(lastUpdateSet).toBeUndefined();
    expect(mockNotifyClients).not.toHaveBeenCalled();
  });

  it("rejects an empty legacy find before mutating the deck", async () => {
    await expect(
      action.run({
        deckId: "deck-1",
        slideId: "slide-1",
        find: "",
        replace: "Fresh",
      }),
    ).rejects.toThrow("find must not be empty");

    expect(lastUpdateSet).toBeUndefined();
    expect(mockNotifyClients).not.toHaveBeenCalled();
  });

  it("rejects mixed edit modes before mutating the deck", async () => {
    const mixedInputs = [
      {
        find: "Old",
        replace: "New",
        edits: [{ find: "Old", replace: "New" }],
      },
      {
        find: "Old",
        fullContent: "<div>Whole slide replacement</div>",
      },
    ];

    for (const input of mixedInputs) {
      await expect(
        action.run({ deckId: "deck-1", slideId: "slide-1", ...input }),
      ).rejects.toThrow("Use exactly one input mode");
    }

    expect(lastUpdateSet).toBeUndefined();
    expect(mockNotifyClients).not.toHaveBeenCalled();
  });

  // A style request fans out one call per slide, so every call is in flight
  // before the first rejection lands and the run's across-arguments breaker
  // ends the turn. The rejection has to carry the accepted call, not just the
  // rule, or the model never gets a chance to correct itself.
  it("answers a styleOnly legacy find/replace with the edits call that would work", async () => {
    mockDeckRow!.data = JSON.stringify({
      title: "Deck",
      slides: [
        {
          id: "slide-1",
          content:
            '<div class="fmd-slide" style="background:#111111"><h1>Headline</h1></div>',
        },
      ],
    });

    const rejection = await action
      .run({
        deckId: "deck-1",
        slideId: "slide-1",
        styleOnly: true,
        find: "background:#111111",
        replace: "background:#f4f0e8",
      })
      .then(
        () => undefined,
        (error: Error) => error,
      );

    expect(rejection?.message).toContain('must use the structured "edits"');
    expect(rejection?.message).toContain(
      '[{"find":"background:#111111","replace":"background:#f4f0e8","occurrence":1}]',
    );
    expect(lastUpdateSet).toBeUndefined();

    // The suggestion is only worth anything if it is a call the action
    // accepts, so replay the payload the rejection handed back instead of a
    // hand-written equivalent.
    const suggested = JSON.parse(
      rejection!.message.slice(
        rejection!.message.indexOf('[{"find"'),
        rejection!.message.lastIndexOf("]") + 1,
      ),
    );
    const result = await action.run({
      deckId: "deck-1",
      slideId: "slide-1",
      styleOnly: true,
      edits: suggested,
    });

    expect(result).toMatchObject({ ok: true, applied: true });
    expect(JSON.parse(lastUpdateSet!.data as string).slides[0].content).toBe(
      '<div class="fmd-slide" style="background:#f4f0e8"><h1>Headline</h1></div>',
    );
  });

  // The legacy find path replaces the first match; the edits path refuses an
  // ambiguous literal outright. A declaration repeated on the slide is the case
  // where a careless conversion swaps one rejection for another.
  it("suggests an edits call that still works when the declaration repeats", async () => {
    mockDeckRow!.data = JSON.stringify({
      title: "Deck",
      slides: [
        {
          id: "slide-1",
          content:
            '<div class="fmd-slide" style="background:#111111"><div style="background:#111111"><h1>Headline</h1></div></div>',
        },
      ],
    });

    const rejection = await action
      .run({
        deckId: "deck-1",
        slideId: "slide-1",
        styleOnly: true,
        find: "background:#111111",
        replace: "background:#f4f0e8",
      })
      .then(
        () => undefined,
        (error: Error) => error,
      );

    const suggested = JSON.parse(
      rejection!.message.slice(
        rejection!.message.indexOf('[{"find"'),
        rejection!.message.lastIndexOf("]") + 1,
      ),
    );
    const result = await action.run({
      deckId: "deck-1",
      slideId: "slide-1",
      styleOnly: true,
      edits: suggested,
    });

    expect(result).toMatchObject({ ok: true, applied: true });
    // First match only, exactly as the rejected legacy call would have done.
    expect(JSON.parse(lastUpdateSet!.data as string).slides[0].content).toBe(
      '<div class="fmd-slide" style="background:#f4f0e8"><div style="background:#111111"><h1>Headline</h1></div></div>',
    );
  });

  it("refuses to route a styleOnly change through objectId", async () => {
    const rejection = await action
      .run({
        deckId: "deck-1",
        slideId: "slide-1",
        styleOnly: true,
        objectId: "slide-object-7",
        replace: "<span>x</span>",
      })
      .then(
        () => undefined,
        (error: Error) => error,
      );

    // objectId only swaps inner content, so echoing it back would hand over a
    // call that cannot reach the element's own style attribute.
    expect(rejection?.message).toContain('cannot go through "objectId"');
    expect(rejection?.message).not.toContain('"objectId":"slide-object-7"');
    expect(rejection?.message).toContain("get-deck (slideId, compact=false)");
    expect(lastUpdateSet).toBeUndefined();
  });

  it("points a styleOnly fullContent attempt at a targeted read instead of echoing it", async () => {
    const rejection = await action
      .run({
        deckId: "deck-1",
        slideId: "slide-1",
        styleOnly: true,
        fullContent: '<div class="fmd-slide">rewritten</div>',
      })
      .then(
        () => undefined,
        (error: Error) => error,
      );

    expect(rejection?.message).toContain("get-deck (slideId, compact=false)");
    expect(rejection?.message).not.toContain("rewritten");
    expect(lastUpdateSet).toBeUndefined();
  });

  it("does not echo an oversized legacy payload back into the rejection", async () => {
    const huge = "a".repeat(5000);
    const rejection = await action
      .run({
        deckId: "deck-1",
        slideId: "slide-1",
        styleOnly: true,
        find: huge,
        replace: "background:#f4f0e8",
      })
      .then(
        () => undefined,
        (error: Error) => error,
      );

    expect(rejection?.message).not.toContain(huge);
    expect(rejection?.message).toContain("get-deck (slideId, compact=false)");
    expect(rejection!.message.length).toBeLessThan(1000);
  });

  it("does not suggest an unusable edits entry for an empty legacy find", async () => {
    const rejection = await action
      .run({
        deckId: "deck-1",
        slideId: "slide-1",
        styleOnly: true,
        find: "",
        replace: "background:#f4f0e8",
      })
      .then(
        () => undefined,
        (error: Error) => error,
      );

    // An empty find cannot become a valid edits entry — applySlideContentEdits
    // rejects it outright — so the generic read-first hint is the only honest
    // answer here.
    expect(rejection?.message).not.toContain('"find":""');
    expect(rejection?.message).toContain("get-deck (slideId, compact=false)");
    expect(lastUpdateSet).toBeUndefined();
  });

  it("teaches styleOnly and the edits requirement in the agent-facing schema", () => {
    const styleOnly = (
      action.schema as unknown as {
        shape: Record<string, { description?: string }>;
      }
    ).shape.styleOnly;

    expect(styleOnly.description).toContain("edits");
    expect(styleOnly.description).toContain('"occurrence":1');
    expect(styleOnly.description).not.toContain('"expectedMatches":1');

    // The advertised tool description is the only styleOnly guidance a model
    // gets before its first call, and a style request gets exactly one batch
    // before the across-arguments breaker ends the turn.
    const advertised = action.tool.description ?? "";
    expect(advertised).toContain("styleOnly=true");
    expect(advertised).toContain('"occurrence":1');
    expect(advertised).not.toContain('"expectedMatches":1');
    expect(advertised).toContain("match slide 1");
    expect(advertised).toContain(".fmd-slide");
  });

  it("rejects style-only edits that change slide structure", async () => {
    mockDeckRow!.data = JSON.stringify({
      title: "Deck",
      slides: [
        {
          id: "slide-1",
          content:
            '<div class="fmd-slide" style="padding: 80px;"><div style="border-width: 1px; border-style: solid; border-color: blue; padding: 20px;"><h1>Headline</h1></div></div>',
        },
      ],
    });

    await expect(
      action.run({
        deckId: "deck-1",
        slideId: "slide-1",
        styleOnly: true,
        edits: [{ find: "Headline", replace: "Changed", expectedMatches: 1 }],
      }),
    ).rejects.toThrow("Style-only slide edits must preserve");

    expect(lastUpdateSet).toBeUndefined();
    expect(mockNotifyClients).not.toHaveBeenCalled();
  });

  it("accepts style-only CSS edits without changing slide structure", async () => {
    mockDeckRow!.data = JSON.stringify({
      title: "Deck",
      slides: [
        {
          id: "slide-1",
          content:
            '<div class="fmd-slide" style="padding: 80px;"><div style="border-width: 1px; border-style: solid; border-color: blue; padding: 20px;"><h1>Headline</h1></div></div>',
        },
      ],
    });

    const result = await action.run({
      deckId: "deck-1",
      slideId: "slide-1",
      styleOnly: true,
      edits: [
        {
          find: "border-color: blue",
          replace: "border-color: red",
          expectedMatches: 1,
        },
      ],
    });

    expect(result).toMatchObject({ ok: true, applied: true });
    expect(JSON.parse(lastUpdateSet!.data as string).slides[0].content).toBe(
      '<div class="fmd-slide" style="padding: 80px;"><div style="border-width: 1px; border-style: solid; border-color: red; padding: 20px;"><h1>Headline</h1></div></div>',
    );
  });

  it("validates formatted style-only edits against the formatted source", async () => {
    mockDeckRow!.data = JSON.stringify({
      title: "Deck",
      slides: [
        {
          id: "slide-1",
          content:
            '<style>.fmd-slide { background: #000; }</style><div class="fmd-slide"><p>Headline</p><div style="white-space: pre-wrap">  keep  these\n    spaces   </div><pre>  alpha\n    beta   \ngamma  </pre></div>',
        },
      ],
    });

    const result = await action.run({
      deckId: "deck-1",
      slideId: "slide-1",
      styleOnly: true,
      format: true,
      edits: [{ find: "background: #000", replace: "background: #fff" }],
    });

    expect(result).toMatchObject({ ok: true, applied: true });
    const savedContent = JSON.parse(lastUpdateSet!.data as string).slides[0]
      .content as string;
    expect(savedContent).toContain("background: #fff");
    expect(savedContent).toContain("Headline");
    expect(savedContent).toContain(
      '<div style="white-space: pre-wrap">  keep  these\n    spaces   </div>',
    );
    expect(savedContent).toContain("<pre>  alpha\n    beta   \ngamma  </pre>");
  });

  it("does not add default slide padding during a style-only edit", async () => {
    mockDeckRow!.data = JSON.stringify({
      title: "Deck",
      slides: [
        {
          id: "slide-1",
          content:
            '<div class="fmd-slide"><div style="border-width: 1px; border-style: solid; border-color: blue;"><h1>Headline</h1></div></div>',
        },
      ],
    });

    await action.run({
      deckId: "deck-1",
      slideId: "slide-1",
      styleOnly: true,
      edits: [
        {
          find: "border-color: blue",
          replace: "border-color: red",
          expectedMatches: 1,
        },
      ],
    });

    expect(JSON.parse(lastUpdateSet!.data as string).slides[0].content).toBe(
      '<div class="fmd-slide"><div style="border-width: 1px; border-style: solid; border-color: red;"><h1>Headline</h1></div></div>',
    );
  });

  it("rejects style-only edits that change protected layout CSS", async () => {
    mockDeckRow!.data = JSON.stringify({
      title: "Deck",
      slides: [
        {
          id: "slide-1",
          content:
            '<div class="fmd-slide" style="padding: 80px;"><div style="border: 1px solid blue; padding: 20px;"><h1>Headline</h1></div></div>',
        },
      ],
    });

    await expect(
      action.run({
        deckId: "deck-1",
        slideId: "slide-1",
        styleOnly: true,
        edits: [
          {
            find: "padding: 20px",
            replace: "padding: 4px",
            expectedMatches: 1,
          },
        ],
      }),
    ).rejects.toThrow("protected layout CSS");

    expect(lastUpdateSet).toBeUndefined();
    expect(mockNotifyClients).not.toHaveBeenCalled();
  });

  it("keeps protected stylesheet declarations attached to their selectors", async () => {
    mockDeckRow!.data = JSON.stringify({
      title: "Deck",
      slides: [
        {
          id: "slide-1",
          content:
            '<style>.left { padding: 10px; } .right { padding: 20px; }</style><div class="left">Left</div><div class="right">Right</div>',
        },
      ],
    });

    await expect(
      action.run({
        deckId: "deck-1",
        slideId: "slide-1",
        styleOnly: true,
        edits: [
          {
            find: ".left { padding: 10px; } .right { padding: 20px; }",
            replace: ".left { padding: 20px; } .right { padding: 10px; }",
            expectedMatches: 1,
          },
        ],
      }),
    ).rejects.toThrow("protected layout CSS");

    expect(lastUpdateSet).toBeUndefined();
  });

  it("rejects style-only edits that change layout custom properties", async () => {
    mockDeckRow!.data = JSON.stringify({
      title: "Deck",
      slides: [
        {
          id: "slide-1",
          content:
            '<div class="fmd-slide" style="--card-padding: 20px; padding: var(--card-padding);"><h1>Headline</h1></div>',
        },
      ],
    });

    await expect(
      action.run({
        deckId: "deck-1",
        slideId: "slide-1",
        styleOnly: true,
        edits: [
          {
            find: "--card-padding: 20px",
            replace: "--card-padding: 4px",
            expectedMatches: 1,
          },
        ],
      }),
    ).rejects.toThrow("protected layout CSS");

    expect(lastUpdateSet).toBeUndefined();
  });

  it("preserves animations for style-only CSS edits", async () => {
    mockDeckRow!.data = JSON.stringify({
      title: "Deck",
      slides: [
        {
          id: "slide-1",
          content:
            '<div class="fmd-slide" style="padding: 80px;"><div style="border-width: 1px; border-style: solid; border-color: blue;"><h1>Headline</h1></div></div>',
          animations: [{ id: "reveal-1", elementPath: [0], type: "fade" }],
        },
      ],
    });

    await action.run({
      deckId: "deck-1",
      slideId: "slide-1",
      styleOnly: true,
      edits: [
        {
          find: "border-color: blue",
          replace: "border-color: red",
          expectedMatches: 1,
        },
      ],
    });

    expect(
      JSON.parse(lastUpdateSet!.data as string).slides[0].animations,
    ).toEqual([{ id: "reveal-1", elementPath: [0], type: "fade" }]);
  });

  it("rejects a stale deck revision instead of overwriting a concurrent write", async () => {
    updateRowsAffected = 0;

    await expect(
      action.run({
        deckId: "deck-1",
        slideId: "slide-1",
        edits: [{ find: "Old", replace: "New" }],
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("changed while saving slide edit"),
      statusCode: 409,
    });

    expect(mockNotifyClients).not.toHaveBeenCalled();
    expect(mockRecordGenerationCreativeContext).not.toHaveBeenCalled();
  });

  it("rejects newly introduced unresolved placeholder content", async () => {
    mockDeckRow!.data = JSON.stringify({
      title: "Deck",
      slides: [
        {
          id: "slide-1",
          content: "<div><h2>Right card content</h2></div>",
        },
      ],
    });

    await expect(
      action.run({
        deckId: "deck-1",
        slideId: "slide-1",
        edits: [
          {
            find: "Right card content",
            replace: "__RIGHT_CARD__",
            expectedMatches: 1,
          },
        ],
      }),
    ).rejects.toThrow("unresolved placeholder content");

    expect(lastUpdateSet).toBeUndefined();
    expect(mockNotifyClients).not.toHaveBeenCalled();
  });

  it("does not persist or clear animations for an optional no-op edit", async () => {
    mockDeckRow!.data = JSON.stringify({
      title: "Deck",
      slides: [
        {
          id: "slide-1",
          content: "<div>Old</div>",
          animations: [{ id: "reveal-1", elementPath: [0] }],
        },
      ],
    });

    // Nothing matched, so nothing was written — and that must reach the
    // runner as a throw. A returned value is stamped `completedSideEffect`
    // and replayed to a resumed run as work already done.
    await expect(
      action.run({
        deckId: "deck-1",
        slideId: "slide-1",
        edits: [{ find: "Missing", replace: "Never written", required: false }],
      }),
    ).rejects.toThrow("Nothing was written");
    expect(lastUpdateSet).toBeUndefined();
    expect(mockNotifyClients).not.toHaveBeenCalled();
  });

  it("does not treat formatter output as an applied optional edit", async () => {
    mockDeckRow!.data = JSON.stringify({
      title: "Deck",
      slides: [
        {
          id: "slide-1",
          content: "<div>Old</div>",
          animations: [{ id: "reveal-1", elementPath: [0] }],
        },
      ],
    });

    await expect(
      action.run({
        deckId: "deck-1",
        slideId: "slide-1",
        format: true,
        edits: [{ find: "Missing", replace: "Never written", required: false }],
      }),
    ).rejects.toThrow("Nothing was written");
    expect(lastUpdateSet).toBeUndefined();
    expect(
      JSON.parse(mockDeckRow!.data as string).slides[0].animations,
    ).toEqual([{ id: "reveal-1", elementPath: [0] }]);
  });

  it("applies ordered code-style edits atomically and returns the new hash", async () => {
    mockDeckRow!.data = JSON.stringify({
      title: "Deck",
      slides: [
        {
          id: "slide-1",
          content: "<div><h1>Old</h1><p>Keep</p></div>",
        },
      ],
    });

    const result = (await action.run({
      deckId: "deck-1",
      slideId: "slide-1",
      edits: [
        { find: ">Old<", replace: ">New<", expectedMatches: 1 },
        {
          op: "insert-before",
          marker: "<p>",
          content: "<strong>Added</strong>",
          expectedMatches: 1,
        },
      ],
    })) as Record<string, unknown>;

    expect(result).toMatchObject({ ok: true, applied: true });
    expect(result.contentHash).toMatch(/^[0-9a-f]+$/);
    const deck = JSON.parse(lastUpdateSet!.data as string);
    expect(deck.slides[0].content).toBe(
      "<div><h1>New</h1><strong>Added</strong><p>Keep</p></div>",
    );
  });

  it("surfaces per-edit results so a skipped optional edit is distinguishable from the batch's aggregate success", async () => {
    const result = (await action.run({
      deckId: "deck-1",
      slideId: "slide-1",
      edits: [
        { find: "Old", replace: "New" },
        {
          op: "insert-after",
          marker: "<marker-not-present>",
          content: '<img src="x">',
          required: false,
        },
      ],
    })) as Record<string, unknown>;

    // The required find/replace matched, but the optional image insert never
    // found its marker. The aggregate `applied` boolean cannot express that,
    // so the result flags it explicitly — otherwise the agent reports the
    // image as inserted.
    expect(result).toMatchObject({ ok: true, applied: true, partial: true });
    const deck = JSON.parse(lastUpdateSet!.data as string);
    expect(deck.slides[0].content).toBe("<div>New</div>");

    expect(result.editResults).toEqual(["replace:first", "insert-after:0"]);
    expect(String(result.message)).toContain("insert-after:0");
  });

  it("does not write a partial edit list when a later edit fails", async () => {
    await expect(
      action.run({
        deckId: "deck-1",
        slideId: "slide-1",
        edits: [
          { find: "Old", replace: "New" },
          { find: "Missing", replace: "Never written" },
        ],
      }),
    ).rejects.toThrow("replace found no matches");
    expect(lastUpdateSet).toBeUndefined();
  });

  it("rejects a patch based on stale slide source", async () => {
    await expect(
      action.run({
        deckId: "deck-1",
        slideId: "slide-1",
        baseContentHash: "fnv1a-stale",
        edits: [{ find: "Old", replace: "New" }],
      }),
    ).rejects.toThrow("changed since it was read");
    expect(lastUpdateSet).toBeUndefined();
  });

  it("rejects a stale write even when the old 32-bit hashes collided", async () => {
    expect(hashSlideContent("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(hashSlideContent("costarring")).not.toBe(hashSlideContent("liquid"));

    mockDeckRow!.data = JSON.stringify({
      title: "Deck",
      updatedAt: "2026-01-01T00:00:00.000Z",
      slides: [{ id: "slide-1", content: "liquid" }],
    });

    await expect(
      action.run({
        deckId: "deck-1",
        slideId: "slide-1",
        baseContentHash: hashSlideContent("costarring"),
        edits: [{ find: "liquid", replace: "stale write" }],
      }),
    ).rejects.toThrow("changed since it was read");
    expect(lastUpdateSet).toBeUndefined();
  });

  it("persists formatted multiline HTML when requested", async () => {
    const result = await action.run({
      deckId: "deck-1",
      slideId: "slide-1",
      format: true,
      edits: [{ find: "Old", replace: "New" }],
    });

    expect(result).toMatchObject({ ok: true, applied: true });
    const deck = JSON.parse(lastUpdateSet!.data as string);
    expect(deck.slides[0].content).toContain("\n");
    expect(deck.slides[0].content).toContain("New");
  });

  it("rejects source-preserving edits that drop imported images", async () => {
    mockDeckRow!.data = JSON.stringify({
      title: "Imported deck",
      sourceImport: {
        mode: "source-preserving",
        format: "pdf",
        fidelity: "source-faithful",
        importedAt: "2026-08-06T00:00:00.000Z",
        slideCount: 1,
        slideIds: ["slide-1"],
        slides: [
          {
            id: "slide-1",
            text: "",
            notes: "",
            imageUrls: ["https://files.example/page.png"],
            editableText: false,
          },
        ],
      },
      slides: [
        {
          id: "slide-1",
          content: '<div><img src="https://files.example/page.png"></div>',
        },
      ],
    });

    await expect(
      action.run({
        deckId: "deck-1",
        slideId: "slide-1",
        fullContent: "<div><h1>Generic replacement</h1></div>",
      }),
    ).rejects.toThrow("remove 1 original image");
    expect(lastUpdateSet).toBeUndefined();
  });

  it("inherits and replaces exact slide provenance without losing other slides", async () => {
    mockDeckRow!.data = JSON.stringify({
      title: "Deck",
      creativeContext: {
        contextMode: "auto",
        contextPackId: "pack-1",
        reuseLabels: [],
      },
      slides: [
        { id: "slide-1", content: "<div>Old</div>" },
        { id: "slide-2", content: "<div>Keep</div>" },
      ],
    });
    mockGetGenerationCreativeContext.mockResolvedValueOnce({
      contextMode: "auto",
      contextPackId: "pack-1",
      elementProvenance: [{ elementId: "slide-2", influence: "generated" }],
    });
    const evidence = {
      itemId: "item-1",
      itemVersionId: "version-1",
      kind: "slide",
      label: "Metrics layout",
      dataRole: "untrusted-reference" as const,
      influence: "adapted" as const,
    };

    await action.run({
      deckId: "deck-1",
      slideId: "slide-1",
      fullContent: "<div>Adapted</div>",
      reuseLabels: [evidence],
    });

    expect(mockValidateGenerationCreativeContext).toHaveBeenCalledWith(
      expect.objectContaining({
        contextPackId: "pack-1",
        contextPackSource: "inherited",
        reuseLabels: [evidence],
        reuseLabelsSource: "explicit",
      }),
    );
    expect(mockRecordGenerationCreativeContext).toHaveBeenCalledWith(
      expect.objectContaining({
        contextPackId: "pack-1",
        elementProvenance: [
          { elementId: "slide-2", influence: "generated" },
          expect.objectContaining({
            elementId: "slide-1",
            influence: "adapted",
            itemId: "item-1",
            itemVersionId: "version-1",
          }),
        ],
      }),
      expect.any(Object),
    );
  });

  it("does not read prior provenance for a one-slide off override", async () => {
    mockDeckRow!.data = JSON.stringify({
      title: "Deck",
      creativeContext: {
        contextMode: "auto",
        contextPackId: "pack-1",
        reuseLabels: [],
      },
      slides: [{ id: "slide-1", content: "<div>Old</div>" }],
    });

    await action.run({
      deckId: "deck-1",
      slideId: "slide-1",
      fullContent: "<div>Unbranded edit</div>",
      contextModeOverride: "off",
    });

    expect(mockGetGenerationCreativeContext).not.toHaveBeenCalled();
    expect(mockRecordGenerationCreativeContext).toHaveBeenCalledWith(
      expect.objectContaining({
        contextMode: "off",
        contextPackId: null,
        elementProvenance: [
          expect.objectContaining({
            elementId: "slide-1",
            influence: "generated",
          }),
        ],
      }),
      expect.any(Object),
    );
  });

  it("throws without writing when the find text is missing", async () => {
    await expect(
      action.run({
        deckId: "deck-1",
        slideId: "slide-1",
        find: "this text does not exist in the slide",
        replace: "x",
      }),
    ).rejects.toThrow("Nothing was written");
    expect(lastUpdateSet).toBeUndefined();
    expect(mockNotifyClients).not.toHaveBeenCalled();
  });

  it("returns a pending fit check keyed to the persisted slide revision", async () => {
    const result = (await action.run({
      deckId: "deck-1",
      slideId: "slide-1",
      fullContent: "<div>Updated</div>",
    })) as Record<string, unknown>;

    expect(result).toMatchObject({
      ok: true,
      deckId: "deck-1",
      slideId: "slide-1",
      layoutFit: {
        status: "pending",
        slideId: "slide-1",
      },
    });
    expect(
      result.layoutFit as {
        contentHash: string;
        layoutFitRevision: string;
      },
    ).toMatchObject({
      contentHash: result.contentHash,
      layoutFitRevision: expect.any(String),
    });
  });
});
