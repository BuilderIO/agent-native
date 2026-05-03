import { beforeEach, describe, expect, it, vi } from "vitest";

const deckRows = [
  {
    id: "deck_123",
    title: "Roadmap",
    data: JSON.stringify({ slides: [{ id: "slide-1" }] }),
    visibility: "private",
    designSystemId: null,
    createdAt: "2026-05-03T00:00:00.000Z",
    updatedAt: "2026-05-03T00:00:00.000Z",
  },
];

const orderByFn = vi.fn(async () => deckRows);
const whereFn = vi.fn(() => ({ orderBy: orderByFn }));
const fromFn = vi.fn(() => ({ where: whereFn }));
const selectFn = vi.fn(() => ({ from: fromFn }));
const mockDb = { select: selectFn };

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    decks: { updatedAt: "updated_at_col" },
    deckShares: {},
  },
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: () => ({ allowed: true }),
}));

vi.mock("drizzle-orm", () => ({
  desc: (value: unknown) => ({ desc: value }),
}));

import action from "./list-decks";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_URL", "https://slides.agent.test");
});

describe("list-decks", () => {
  it("returns canonical deck URLs for A2A artifact verification", async () => {
    const result = await action.run({});

    expect(result.decks[0]).toMatchObject({
      id: "deck_123",
      title: "Roadmap",
      url: "https://slides.agent.test/deck/deck_123",
      slideCount: 1,
    });
  });

  it("includes URLs in compact output too", async () => {
    const result = await action.run({ compact: "true" });

    expect(result.decks[0]).toMatchObject({
      id: "deck_123",
      url: "https://slides.agent.test/deck/deck_123",
    });
  });
});
