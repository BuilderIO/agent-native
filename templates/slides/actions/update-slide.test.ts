import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.fn();
const mockAssertAccess = vi.fn();
const mockNotifyClients = vi.fn();

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
});
