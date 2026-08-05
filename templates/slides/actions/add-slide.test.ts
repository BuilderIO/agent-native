import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.fn();
const mockNotifyClients = vi.fn();
const mockReadAppState = vi.fn(async () => null);
const mockWriteAppState = vi.fn(async () => undefined);
let mockRunContext: { browserTabId?: string } | undefined;
// Each test sets this; the helper consults it to decide whether to report
// overflow, fit, or timeout.
let mockFitCheckResult:
  | { status: "fits" | "overflows" | "timeout"; measurement?: unknown }
  | undefined;

let deckData: Record<string, unknown>;
let updatedFields: Record<string, unknown> | undefined;

const whereSelectFn = vi.fn(async () => [
  {
    id: "deck-1",
    data: JSON.stringify(deckData),
  },
]);
const fromFn = vi.fn(() => ({ where: whereSelectFn }));
const selectFn = vi.fn(() => ({ from: fromFn }));

const whereUpdateFn = vi.fn(async () => undefined);
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
}));

vi.mock("../server/lib/deck-versions.js", () => ({
  createDeckVersionSnapshot: vi.fn(async () => ({ created: true })),
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: (...args: unknown[]) => mockReadAppState(...args),
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestRunContext: () => mockRunContext,
}));

vi.mock("./_await-fit-check.js", () => ({
  awaitLayoutFitCheck: async () => mockFitCheckResult ?? { status: "timeout" },
  formatOverflowForTool: (deckId: string, m: { verticalOverflow: number }) =>
    `MOCK_OVERFLOW_MESSAGE deck=${deckId} overflow=${m.verticalOverflow}`,
}));

import action from "./add-slide";

beforeEach(() => {
  vi.clearAllMocks();
  mockRunContext = undefined;
  mockReadAppState.mockResolvedValue(null);
  mockWriteAppState.mockResolvedValue(undefined);
  mockFitCheckResult = undefined;
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

  it("scopes auto-navigation to the requesting browser tab", async () => {
    mockRunContext = { browserTabId: "slides-tab-a" };
    mockReadAppState.mockImplementation(async (key) => {
      if (key === "navigation:slides-tab-a") {
        return { view: "editor", deckId: "deck-1" };
      }
      if (key === "navigation") {
        return { view: "editor", deckId: "deck-other" };
      }
      return null;
    });

    await action.run({
      deckId: "deck-1",
      slideId: "slide-new",
      content: "<div>New</div>",
      position: 1,
    });

    expect(mockReadAppState).toHaveBeenCalledWith("navigation:slides-tab-a");
    expect(mockReadAppState).not.toHaveBeenCalledWith("navigation");
    expect(mockWriteAppState).toHaveBeenCalledWith(
      "navigate:slides-tab-a",
      expect.objectContaining({
        deckId: "deck-1",
        slideIndex: 1,
      }),
    );
    expect(mockWriteAppState).not.toHaveBeenCalledWith(
      "navigate",
      expect.anything(),
    );
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

  it("appends layoutOverflow + auto-fix message when the editor reports vertical overflow", async () => {
    mockFitCheckResult = {
      status: "overflows",
      measurement: {
        slideId: "slide-new",
        contentHeight: 645,
        viewportHeight: 420,
        verticalOverflow: 225,
        measuredAt: Date.now(),
      },
    };

    const result = (await action.run({
      deckId: "deck-1",
      slideId: "slide-new",
      content: "<div>New</div>",
    })) as Record<string, unknown>;

    expect(result).toMatchObject({
      deckId: "deck-1",
      slideId: "slide-new",
      layoutOverflow: {
        verticalOverflow: 225,
        contentHeight: 645,
        viewportHeight: 420,
      },
    });
    expect(result.message).toMatch(/MOCK_OVERFLOW_MESSAGE/);
  });

  it("omits layoutOverflow when the editor reports the slide fits", async () => {
    mockFitCheckResult = {
      status: "fits",
      measurement: {
        slideId: "slide-new",
        contentHeight: 380,
        viewportHeight: 420,
        verticalOverflow: 0,
        measuredAt: Date.now(),
      },
    };

    const result = (await action.run({
      deckId: "deck-1",
      slideId: "slide-new",
      content: "<div>New</div>",
    })) as Record<string, unknown>;

    expect(result.layoutOverflow).toBeUndefined();
    expect(result.message).toBeUndefined();
  });

  it("omits layoutOverflow when no editor is open to measure (timeout)", async () => {
    mockFitCheckResult = { status: "timeout" };

    const result = (await action.run({
      deckId: "deck-1",
      slideId: "slide-new",
      content: "<div>New</div>",
    })) as Record<string, unknown>;

    expect(result.layoutOverflow).toBeUndefined();
    expect(result.message).toBeUndefined();
    expect(result).toMatchObject({
      deckId: "deck-1",
      slideId: "slide-new",
      slideCount: 3,
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
