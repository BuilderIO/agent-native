import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.fn();
const mockNotifyClients = vi.fn();

let mockDeckRow: Record<string, unknown> | undefined;
let updatedFields: Record<string, unknown> | undefined;

const mockDb = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => (mockDeckRow ? [mockDeckRow] : []),
      }),
    }),
  }),
  update: () => ({
    set: (fields: Record<string, unknown>) => {
      updatedFields = fields;
      return { where: async () => undefined };
    },
  }),
};

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    decks: { id: "decks.id", data: "decks.data" },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ eq: args }),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: (...args: unknown[]) => mockNotifyClients(...args),
}));

import action from "./apply-design-system";

beforeEach(() => {
  vi.clearAllMocks();
  updatedFields = undefined;
  mockDeckRow = {
    id: "deck-1",
    data: JSON.stringify({
      title: "Deck",
      slides: [{ id: "slide-1", content: "<div>Existing slide</div>" }],
    }),
  };
});

describe("apply-design-system", () => {
  it("links the design system without rewriting existing slide content", async () => {
    const result = await action.run({
      deckId: "deck-1",
      designSystemId: "design-system-1",
    });

    expect(result).toMatchObject({
      deckId: "deck-1",
      designSystemId: "design-system-1",
      applied: true,
      existingSlidesUnchanged: true,
    });
    expect(mockAssertAccess).toHaveBeenCalledWith(
      "deck",
      "deck-1",
      "editor",
    );
    expect(mockAssertAccess).toHaveBeenCalledWith(
      "design-system",
      "design-system-1",
      "viewer",
    );
    const updated = JSON.parse(updatedFields!.data as string);
    expect(updated.slides[0].content).toBe("<div>Existing slide</div>");
    expect(mockNotifyClients).toHaveBeenCalledWith("deck-1");
  });

  it("clears a stale ad-hoc theme contract when linking a design system", async () => {
    mockDeckRow!.data = JSON.stringify({
      title: "Deck",
      themeContract: {
        mode: "dark",
        vars: { bg: "#10261C" },
        sourceSlideId: "slide-1",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      slides: [{ id: "slide-1", content: "<div>Existing slide</div>" }],
    });

    await action.run({
      deckId: "deck-1",
      designSystemId: "design-system-1",
    });

    const updated = JSON.parse(updatedFields!.data as string);
    expect(updated).not.toHaveProperty("themeContract");
  });

  it("fails for a missing deck instead of writing", async () => {
    mockDeckRow = undefined;

    await expect(
      action.run({ deckId: "missing-deck", designSystemId: "design-system-1" }),
    ).rejects.toMatchObject({ errorCode: "deck_not_found" });
    expect(updatedFields).toBeUndefined();
  });
});
