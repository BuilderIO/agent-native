import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.fn();
const mockNotifyClients = vi.fn();

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
});

describe("update-slide", () => {
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
    expect(mockRecordGenerationCreativeContext).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactId: "deck-1",
        contextMode: "auto",
        contextPackId: null,
        elementProvenance: [
          expect.objectContaining({
            elementId: "slide-1",
            influence: "generated",
          }),
        ],
      }),
      expect.objectContaining({ db: mockDb }),
    );
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

  it("rejects style-only edits that change slide structure", async () => {
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
            '<div class="fmd-slide" style="padding: 80px;"><div style="border: 1px solid blue; padding: 20px;"><h1>Headline</h1></div></div>',
        },
      ],
    });

    const result = await action.run({
      deckId: "deck-1",
      slideId: "slide-1",
      styleOnly: true,
      edits: [
        {
          find: "border: 1px solid blue",
          replace: "border: 0",
          expectedMatches: 1,
        },
      ],
    });

    expect(result).toMatchObject({ ok: true, applied: true });
    expect(JSON.parse(lastUpdateSet!.data as string).slides[0].content).toBe(
      '<div class="fmd-slide" style="padding: 80px;"><div style="border: 0; padding: 20px;"><h1>Headline</h1></div></div>',
    );
  });

  it("does not add default slide padding during a style-only edit", async () => {
    mockDeckRow!.data = JSON.stringify({
      title: "Deck",
      slides: [
        {
          id: "slide-1",
          content:
            '<div class="fmd-slide"><div style="border: 1px solid blue;"><h1>Headline</h1></div></div>',
        },
      ],
    });

    await action.run({
      deckId: "deck-1",
      slideId: "slide-1",
      styleOnly: true,
      edits: [
        {
          find: "border: 1px solid blue",
          replace: "border: 0",
          expectedMatches: 1,
        },
      ],
    });

    expect(JSON.parse(lastUpdateSet!.data as string).slides[0].content).toBe(
      '<div class="fmd-slide"><div style="border: 0;"><h1>Headline</h1></div></div>',
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
            '<div class="fmd-slide" style="padding: 80px;"><div style="border: 1px solid blue;"><h1>Headline</h1></div></div>',
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
          find: "border: 1px solid blue",
          replace: "border: 0",
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
