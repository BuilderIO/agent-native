import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.fn();
const mockAssertAccess = vi.fn();
const mockNotifyClients = vi.fn();
let mockFitCheckResult:
  | { status: "fits" | "overflows" | "timeout"; measurement?: unknown }
  | undefined;

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute: mockExecute }),
}));

vi.mock("@agent-native/core/collab", () => ({
  hasCollabState: vi.fn(async () => false),
  agentEnterDocument: vi.fn(),
  agentLeaveDocument: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: (...args: unknown[]) => mockNotifyClients(...args),
}));

vi.mock("../server/db/index.js", () => ({}));

vi.mock("./_await-fit-check.js", () => ({
  awaitLayoutFitCheck: async () => mockFitCheckResult ?? { status: "timeout" },
  formatOverflowForTool: (deckId: string, m: { verticalOverflow: number }) =>
    `MOCK_OVERFLOW_MESSAGE deck=${deckId} overflow=${m.verticalOverflow}`,
}));

import action from "./update-slide";

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockImplementation(async (query: { sql: string }) => {
    if (query.sql.startsWith("SELECT data FROM decks")) {
      return {
        rows: [
          {
            data: JSON.stringify({
              title: "Deck",
              updatedAt: "2026-01-01T00:00:00.000Z",
              slides: [{ id: "slide-1", content: "<div>Old</div>" }],
            }),
          },
        ],
      };
    }
    return { rows: [], rowsAffected: 1 };
  });
});

describe("update-slide", () => {
  it("bumps deck JSON updatedAt so fallback polling detects same-slide edits", async () => {
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

    const updateCall = mockExecute.mock.calls.find(([query]) =>
      String(query.sql).startsWith("UPDATE decks SET data = ?"),
    );
    expect(updateCall).toBeDefined();
    const [query] = updateCall!;
    const [rawDeck, rowUpdatedAt, deckId] = query.args;
    const deck = JSON.parse(rawDeck as string);

    expect(deckId).toBe("deck-1");
    expect(deck.slides[0].content).toBe("<div>New</div>");
    expect(deck.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
    expect(rowUpdatedAt).toBe(deck.updatedAt);
    expect(mockNotifyClients).toHaveBeenCalledWith("deck-1");
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

    // When find is not found in either Yjs or SQL, the action returns
    // ok: false BEFORE doing the fit-check. layoutOverflow must NOT appear.
    expect(result.ok).toBe(false);
    expect(result.layoutOverflow).toBeUndefined();
  });
});
