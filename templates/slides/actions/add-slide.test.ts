import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashSlideContent } from "../shared/slide-fit";

const mockAssertAccess = vi.fn();
const mockNotifyClients = vi.fn();
const mockReadAppState = vi.fn(async () => null);
const mockWriteAppState = vi.fn(async () => undefined);

let deckData: Record<string, unknown>;
let updatedFields: Record<string, unknown> | undefined;

const whereSelectFn = vi.fn(async () => [
  {
    id: "deck-1",
    data: JSON.stringify(deckData),
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
]);
const fromFn = vi.fn(() => ({ where: whereSelectFn }));
const selectFn = vi.fn(() => ({ from: fromFn }));

const whereUpdateFn = vi.fn(async () => ({ rowsAffected: 1 }));
const setFn = vi.fn((fields: Record<string, unknown>) => {
  updatedFields = fields;
  return { where: whereUpdateFn };
});
const updateFn = vi.fn(() => ({ set: setFn }));
const transactionFn = vi.fn(
  async (callback: (tx: { update: typeof updateFn }) => Promise<unknown>) =>
    callback({ update: updateFn }),
);

const mockDb = {
  select: selectFn,
  update: updateFn,
  transaction: transactionFn,
};

const mockGetGenerationCreativeContext = vi.fn(async () => null);
const mockRecordGenerationCreativeContext = vi.fn(async () => undefined);
const mockCreateDeckVersionSnapshot = vi.fn(async () => ({ created: true }));
const mockDeckVersionChatContextFromAction = vi.fn(
  (context?: {
    caller?: string;
    threadId?: string;
    runId?: string;
    turnId?: string;
  }) =>
    context?.caller === "webmcp"
      ? {
          threadId: context.threadId,
          runId: context.runId,
          turnId: context.turnId,
        }
      : undefined,
);
const mockValidateGenerationCreativeContext = vi.fn(
  async (input: {
    contextPackId?: string;
    contextModeOverride?: "off";
    reuseLabels?: Array<Record<string, unknown>>;
  }) => ({
    contextMode:
      input.contextModeOverride === "off"
        ? ("off" as const)
        : input.contextPackId
          ? ("auto" as const)
          : ("off" as const),
    contextPackId:
      input.contextModeOverride === "off"
        ? null
        : (input.contextPackId ?? null),
    reuseLabels: input.reuseLabels ?? [],
    results: [],
  }),
);

vi.mock("@agent-native/creative-context/server", () => ({
  getGenerationCreativeContext: (...args: unknown[]) =>
    mockGetGenerationCreativeContext(...args),
  recordGenerationCreativeContext: (...args: unknown[]) =>
    mockRecordGenerationCreativeContext(...args),
  validateGenerationCreativeContext: (...args: unknown[]) =>
    mockValidateGenerationCreativeContext(...args),
  validateCreativeContextReuseLabels: (
    labels: Array<Record<string, unknown>>,
  ) => labels,
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

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    decks: { id: "id_col", data: "data_col", updatedAt: "ua_col" },
  },
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: (...args: unknown[]) => mockNotifyClients(...args),
}));

const mockAgentTouchDocument = vi.fn();
vi.mock("@agent-native/core/collab", () => ({
  agentTouchDocument: (...args: unknown[]) => mockAgentTouchDocument(...args),
}));

// Real per-deck lock just runs the fn; a passthrough keeps the unit test focused
// on add-slide's own logic without exercising the shared lock module.
vi.mock("./patch-deck.js", () => ({
  withDeckLock: (_deckId: string, fn: () => Promise<unknown>) => fn(),
  isAgentPatchCaller: (caller: string | undefined) =>
    caller === "tool" ||
    caller === "mcp" ||
    caller === "a2a" ||
    caller === "webmcp",
}));

vi.mock("../server/lib/deck-versions.js", () => ({
  createDeckVersionSnapshot: (...args: unknown[]) =>
    mockCreateDeckVersionSnapshot(...args),
  deckVersionChatContextFromAction: (...args: unknown[]) =>
    mockDeckVersionChatContextFromAction(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (col: unknown, val: unknown) => ({ col, val }),
  isNull: (col: unknown) => ({ isNull: col }),
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: (...args: unknown[]) => mockReadAppState(...args),
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestRunContext: () => undefined,
}));

import action from "./add-slide";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetGenerationCreativeContext.mockResolvedValue(null);
  deckData = {
    title: "Test deck",
    slides: [
      { id: "slide-1", content: "<div>One</div>" },
      { id: "slide-2", content: "<div>Two</div>" },
    ],
  };
  updatedFields = undefined;
});

describe("add-slide", () => {
  it("does not advertise parallel execution for deck writes", () => {
    expect(action.parallelSafe).toBeUndefined();
  });

  it.each(["tool", "webmcp"] as const)(
    "rejects agent additions after the requested slide count for %s callers",
    async (caller) => {
      deckData.generationContext = { targetSlideCount: 2 };

      await expect(
        action.run(
          {
            deckId: "deck-1",
            slideId: "slide-new",
            content: "<div>New</div>",
          },
          { caller },
        ),
      ).rejects.toMatchObject({
        errorCode: "target_slide_count_reached",
        details: {
          deckId: "deck-1",
          currentSlideCount: 2,
          targetSlideCount: 2,
        },
      });
      expect(updateFn).not.toHaveBeenCalled();
    },
  );

  it("forces a WebMCP version snapshot with its run context", async () => {
    deckData.generationContext = { targetSlideCount: 3 };

    await action.run(
      {
        deckId: "deck-1",
        slideId: "slide-new",
        content: "<div>New</div>",
      },
      {
        caller: "webmcp",
        threadId: "thread-webmcp",
        runId: "run-webmcp",
        turnId: "turn-webmcp",
      },
    );

    expect(mockCreateDeckVersionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ id: "deck-1" }),
      expect.objectContaining({
        force: true,
        chatContext: {
          threadId: "thread-webmcp",
          runId: "run-webmcp",
          turnId: "turn-webmcp",
        },
      }),
    );
  });

  it("allows an agent to extend the target after an explicit follow-up", async () => {
    deckData.generationContext = { targetSlideCount: 2 };

    await action.run(
      {
        deckId: "deck-1",
        slideId: "slide-follow-up",
        content: "<div>Follow-up</div>",
        targetSlideCountOverride: 3,
      },
      { caller: "tool" },
    );

    const updated = JSON.parse(updatedFields!.data as string);
    expect(updated.generationContext.targetSlideCount).toBe(3);
    expect(updated.slides).toHaveLength(3);
  });

  it("repairs an opaque generated title from the first slide", async () => {
    deckData = {
      title: "H3sVsnns-TEVUOpz9w",
      slides: [],
    };

    await action.run({
      deckId: "deck-1",
      slideId: "slide-title",
      layout: "title",
      content:
        '<div class="fmd-slide"><div style="font-size: 54px;">Agent-Native Strategy</div></div>',
    });

    expect(updatedFields?.title).toBe("Agent-Native Strategy");
    expect(JSON.parse(updatedFields!.data as string).title).toBe(
      "Agent-Native Strategy",
    );
  });

  it("persists speaker notes separately from the slide HTML", async () => {
    await action.run({
      deckId: "deck-1",
      slideId: "slide-notes",
      content: "<div>New</div>",
      notes: "Explain the customer outcome before advancing.",
    });

    const updated = JSON.parse(updatedFields!.data as string);
    expect(updated.slides[2]).toMatchObject({
      id: "slide-notes",
      content: "<div>New</div>",
      notes: "Explain the customer outcome before advancing.",
    });
  });

  it("preserves explicitly empty speaker notes when provided", async () => {
    await action.run({
      deckId: "deck-1",
      slideId: "slide-empty-notes",
      content: "<div>New</div>",
      notes: "",
    });

    const updated = JSON.parse(updatedFields!.data as string);
    expect(updated.slides[2]).toHaveProperty("notes", "");
  });

  it("accepts CLI-style string positions and inserts at the requested index", async () => {
    const result = await action.run({
      deckId: "deck-1",
      slideId: "slide-new",
      content: "<div>New</div>",
      position: "1",
    });

    expect(result).toMatchObject({
      deckId: "deck-1",
      slideId: "slide-new",
      slideNumber: 2,
      position: 1,
      slideCount: 3,
    });
    expect(updatedFields).toBeDefined();
    const updated = JSON.parse(updatedFields!.data as string);
    expect(updated.slides.map((slide: { id: string }) => slide.id)).toEqual([
      "slide-1",
      "slide-new",
      "slide-2",
    ]);
    expect(mockAssertAccess).toHaveBeenCalledWith("deck", "deck-1", "editor");
    // The broadcast now carries the new slideId + agent actor (backwards-
    // compatible payload — the { type, deckId } fields are still present).
    expect(mockNotifyClients).toHaveBeenCalledWith("deck-1", {
      slideId: "slide-new",
      actor: "agent",
    });
    // The agent's presence is recorded on the DECK presence doc for the new
    // slide so the editor can light it up + show a lingering "AI edited" tag.
    expect(mockAgentTouchDocument).toHaveBeenCalledWith(
      "deck-deck-1",
      expect.objectContaining({
        metadata: { slide: "slide-new" },
        edit: expect.objectContaining({
          descriptor: { kind: "paths", paths: ["slides.slide-new"] },
        }),
      }),
    );
  });

  it("does not auto-navigate the editor to the generated slide", async () => {
    await action.run({
      deckId: "deck-1",
      slideId: "slide-new",
      content: "<div>New</div>",
      position: 1,
    });

    expect(mockReadAppState).not.toHaveBeenCalled();
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });

  it("rejects empty string positions", async () => {
    await expect(
      action.run({
        deckId: "deck-1",
        slideId: "slide-new",
        content: "<div>New</div>",
        position: "",
      }),
    ).rejects.toThrow();
  });

  it("rejects null positions", async () => {
    await expect(
      action.run({
        deckId: "deck-1",
        slideId: "slide-new",
        content: "<div>New</div>",
        position: null as unknown as number,
      }),
    ).rejects.toThrow();
  });

  it("returns a pending fit check keyed to the new slide revision", async () => {
    const result = (await action.run({
      deckId: "deck-1",
      slideId: "slide-new",
      content: "<div>New</div>",
    })) as Record<string, unknown>;

    expect(result).toMatchObject({
      deckId: "deck-1",
      slideId: "slide-new",
      slideCount: 3,
      layoutFit: {
        status: "pending",
        slideId: "slide-new",
      },
    });
    expect(
      result.layoutFit as {
        contentHash: string;
        layoutFitRevision: string;
      },
    ).toMatchObject({
      contentHash: hashSlideContent("<div>New</div>"),
      layoutFitRevision: expect.any(String),
    });
  });

  it("inherits the deck pack and appends exact slide provenance", async () => {
    const existingLabel = {
      itemId: "item-1",
      itemVersionId: "version-1",
      kind: "slide",
      label: "Title slide",
      dataRole: "untrusted-reference" as const,
      elementId: "slide-1",
      influence: "adapted" as const,
    };
    const newLabel = {
      itemId: "item-2",
      itemVersionId: "version-2",
      kind: "slide",
      label: "Metrics slide",
      dataRole: "untrusted-reference" as const,
      influence: "reused" as const,
    };
    deckData.creativeContext = {
      contextMode: "auto",
      contextPackId: "pack-1",
      reuseLabels: [existingLabel],
    };
    mockGetGenerationCreativeContext.mockResolvedValue({
      id: "generation-1",
      appId: "slides",
      artifactType: "deck",
      artifactId: "deck-1",
      contextMode: "auto",
      contextPackId: "pack-1",
      elementProvenance: [
        {
          elementId: "slide-1",
          influence: "adapted",
          itemId: "item-1",
          itemVersionId: "version-1",
        },
      ],
      createdAt: "2026-07-16T00:00:00.000Z",
    });

    await action.run({
      deckId: "deck-1",
      slideId: "slide-new",
      content: "<div>New</div>",
      reuseLabels: [newLabel],
    });

    expect(mockValidateGenerationCreativeContext).toHaveBeenCalledWith(
      expect.objectContaining({
        contextPackId: "pack-1",
        contextPackSource: "inherited",
        reuseLabels: [newLabel],
        reuseLabelsSource: "explicit",
      }),
    );
    const updated = JSON.parse(updatedFields!.data as string);
    expect(updated.creativeContext).toMatchObject({
      contextMode: "auto",
      contextPackId: "pack-1",
    });
    expect(updated.creativeContext.reuseLabels).toHaveLength(2);
    expect(updated.slides[2].creativeContextReuseLabels).toEqual([
      { ...newLabel, elementId: "slide-new" },
    ]);
    expect(mockRecordGenerationCreativeContext).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactId: "deck-1",
        contextPackId: "pack-1",
        elementProvenance: [
          expect.objectContaining({ elementId: "slide-1" }),
          expect.objectContaining({
            elementId: "slide-new",
            itemId: "item-2",
            itemVersionId: "version-2",
            influence: "reused",
          }),
        ],
      }),
      expect.objectContaining({ db: expect.anything() }),
    );
  });

  it("rejects a pack that differs from the deck before mutating", async () => {
    deckData.creativeContext = {
      contextMode: "auto",
      contextPackId: "pack-1",
      reuseLabels: [],
    };

    await expect(
      action.run({
        deckId: "deck-1",
        slideId: "slide-new",
        content: "<div>New</div>",
        contextPackId: "pack-2",
      }),
    ).rejects.toThrow(/existing creative-context pack/);
    expect(updateFn).not.toHaveBeenCalled();
    expect(mockRecordGenerationCreativeContext).not.toHaveBeenCalled();
  });

  it("records a one-slide off override without clearing the deck's saved pack", async () => {
    deckData.creativeContext = {
      contextMode: "auto",
      contextPackId: "pack-1",
      reuseLabels: [
        {
          itemId: "item-1",
          itemVersionId: "version-1",
          kind: "slide",
          label: "Prior slide",
          dataRole: "untrusted-reference",
          elementId: "slide-1",
        },
      ],
    };

    const result = await action.run({
      deckId: "deck-1",
      slideId: "slide-new",
      content: "<div>Unbranded</div>",
      contextModeOverride: "off",
    });

    expect(result).toMatchObject({ contextMode: "off", contextPackId: null });
    const updated = JSON.parse(updatedFields!.data as string);
    expect(updated.creativeContext).toMatchObject({
      contextMode: "auto",
      contextPackId: "pack-1",
    });
    expect(mockGetGenerationCreativeContext).not.toHaveBeenCalled();
    expect(mockRecordGenerationCreativeContext).toHaveBeenCalledWith(
      expect.objectContaining({
        contextMode: "off",
        contextPackId: null,
        reuseLabels: [
          expect.objectContaining({
            elementId: "slide-new",
            influence: "generated",
          }),
        ],
        elementProvenance: [
          expect.objectContaining({
            elementId: "slide-new",
            influence: "generated",
          }),
        ],
      }),
      expect.any(Object),
    );
  });
});
