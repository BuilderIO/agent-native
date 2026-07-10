import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.fn();
const mockNotifyClients = vi.fn();
let mockFitCheckResult:
  | { status: "fits" | "overflows" | "timeout"; measurement?: unknown }
  | undefined;

// Captured by the Drizzle `update().set()` mock so tests can assert on the
// persisted deck JSON + bumped updatedAt.
let lastUpdateSet: { data?: string; updatedAt?: string } | undefined;

let mockDeckRow: Record<string, unknown> | undefined;

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
      return { where: async () => ({ rowsAffected: 1 }) };
    },
  }),
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
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ eq: args }),
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: ({ params }: { params: { deckId: string } }) =>
    `/deck/${params.deckId}`,
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

// Real per-deck lock just runs the fn; passthrough keeps the unit test focused
// on update-slide's own read-modify-write logic.
vi.mock("./patch-deck.js", () => ({
  withDeckLock: (_deckId: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("../server/lib/deck-versions.js", () => ({
  createDeckVersionSnapshot: vi.fn(async () => ({ created: true })),
}));

vi.mock("./_await-fit-check.js", () => ({
  awaitLayoutFitCheck: async () => mockFitCheckResult ?? { status: "timeout" },
  formatOverflowForTool: (deckId: string, m: { verticalOverflow: number }) =>
    `MOCK_OVERFLOW_MESSAGE deck=${deckId} overflow=${m.verticalOverflow}`,
}));

import action from "./update-slide";

beforeEach(() => {
  vi.clearAllMocks();
  lastUpdateSet = undefined;
  mockFitCheckResult = undefined;
  mockDeckRow = {
    id: "deck-1",
    title: "Deck",
    ownerEmail: "owner@example.com",
    data: JSON.stringify({
      title: "Deck",
      updatedAt: "2026-01-01T00:00:00.000Z",
      slides: [{ id: "slide-1", content: "<div>Old</div>" }],
    }),
  };
});

describe("update-slide", () => {
  it("applies the edit, bumps deck updatedAt, persists, and notifies clients", async () => {
    const result = await action.run({
      deckId: "deck-1",
      slideId: "slide-1",
      fullContent: "<div>New</div>",
    });

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
    expect(deck.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
    expect(lastUpdateSet!.updatedAt).toBe(deck.updatedAt);
    // The broadcast now carries the changed slideId + agent actor (backwards-
    // compatible — { type, deckId } are still present in the wire payload).
    expect(mockNotifyClients).toHaveBeenCalledWith("deck-1", {
      slideId: "slide-1",
      actor: "agent",
    });
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

  it("returns ok:false without writing when the find text is missing", async () => {
    const result = (await action.run({
      deckId: "deck-1",
      slideId: "slide-1",
      find: "this text does not exist in the slide",
      replace: "x",
    })) as Record<string, unknown>;

    expect(result.ok).toBe(false);
    expect(result.layoutOverflow).toBeUndefined();
    expect(lastUpdateSet).toBeUndefined();
    expect(mockNotifyClients).not.toHaveBeenCalled();
  });

  it("returns layoutOverflow + auto-fix message when the patched slide still overflows", async () => {
    mockFitCheckResult = {
      status: "overflows",
      measurement: {
        slideId: "slide-1",
        contentHeight: 645,
        viewportHeight: 420,
        verticalOverflow: 225,
        measuredAt: Date.now(),
      },
    };

    const result = (await action.run({
      deckId: "deck-1",
      slideId: "slide-1",
      fullContent: "<div>Tightened but still tall</div>",
    })) as Record<string, unknown>;

    expect(result).toMatchObject({
      ok: true,
      deckId: "deck-1",
      slideId: "slide-1",
      layoutOverflow: {
        verticalOverflow: 225,
        contentHeight: 645,
        viewportHeight: 420,
      },
    });
    expect(result.message).toMatch(/MOCK_OVERFLOW_MESSAGE/);
  });

  it("omits layoutOverflow when the patched slide fits", async () => {
    mockFitCheckResult = {
      status: "fits",
      measurement: {
        slideId: "slide-1",
        contentHeight: 380,
        viewportHeight: 420,
        verticalOverflow: 0,
        measuredAt: Date.now(),
      },
    };

    const result = (await action.run({
      deckId: "deck-1",
      slideId: "slide-1",
      fullContent: "<div>Now fits</div>",
    })) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(result.layoutOverflow).toBeUndefined();
    expect(result.message).toBeUndefined();
  });

  it("omits layoutOverflow on fit-check timeout (no open editor)", async () => {
    mockFitCheckResult = { status: "timeout" };

    const result = (await action.run({
      deckId: "deck-1",
      slideId: "slide-1",
      fullContent: "<div>Headless</div>",
    })) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(result.layoutOverflow).toBeUndefined();
    expect(result.message).toBeUndefined();
  });

  it("does not consult fit-check when text-to-find is not present (early bail)", async () => {
    mockFitCheckResult = {
      status: "overflows",
      measurement: {
        slideId: "slide-1",
        contentHeight: 645,
        viewportHeight: 420,
        verticalOverflow: 225,
        measuredAt: Date.now(),
      },
    };

    const result = (await action.run({
      deckId: "deck-1",
      slideId: "slide-1",
      find: "this text does not exist in the slide",
      replace: "x",
    })) as Record<string, unknown>;

    // When find is not found, the action returns ok: false BEFORE the
    // fit-check. layoutOverflow must NOT appear.
    expect(result.ok).toBe(false);
    expect(result.layoutOverflow).toBeUndefined();
  });
});
