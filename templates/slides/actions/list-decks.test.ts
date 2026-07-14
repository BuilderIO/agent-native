import { beforeEach, describe, expect, it, vi } from "vitest";

const deckRows = [
  {
    id: "deck_123",
    title: "Roadmap",
    data: JSON.stringify({ slides: [{ id: "slide-1" }] }),
    visibility: "private",
    designSystemId: null,
    ownerEmail: "alice@example.com",
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
    decks: {
      id: "id_col",
      title: "title_col",
      ownerEmail: "owner_email_col",
      updatedAt: "updated_at_col",
      visibility: "visibility_col",
    },
    deckShares: {},
  },
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "alice@example.com",
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: () => ({ allowed: true }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...values: unknown[]) => ({ and: values }),
  desc: (value: unknown) => ({ desc: value }),
  eq: (column: unknown, value: unknown) => ({ column, value }),
  sql: vi.fn((strings, ...values) => ({ strings, values })),
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

  it("projects only metadata columns and never selects the deck body for light mode", async () => {
    const result = await action.run({ light: "true" });

    // The `data` column (each deck's full slide JSON) must never appear in
    // the light-mode projection — this is the poll/diff path's whole point.
    expect(selectFn).toHaveBeenCalledWith({
      id: "id_col",
      title: "title_col",
      updatedAt: "updated_at_col",
      visibility: "visibility_col",
    });
    expect(result.count).toBe(1);
  });

  it("can limit results to decks created by the current user", async () => {
    await action.run({ createdBy: "me" });

    expect(whereFn).toHaveBeenCalledWith({
      and: [
        { allowed: true },
        { column: "owner_email_col", value: "alice@example.com" },
      ],
    });
  });
});
