import { beforeEach, describe, expect, it, vi } from "vitest";

let deckRows = [
  {
    id: "deck_123",
    title: "Roadmap",
    data: JSON.stringify({ slides: [{ id: "slide-1" }] }),
    previewSlide: JSON.stringify({ id: "slide-1" }),
    aspectRatio: "4:3",
    visibility: "private",
    designSystemId: null,
    ownerEmail: "Alice@Example.com",
    createdAt: "2026-05-03T00:00:00.000Z",
    updatedAt: "2026-05-03T00:00:00.000Z",
  },
];

let requestUserEmail = "alice@example.com";

const limitFn = vi.fn(async (limit: number) => deckRows.slice(0, limit));
const orderByFn = vi.fn(() =>
  Object.assign(Promise.resolve(deckRows), { limit: limitFn }),
);
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
      designSystemId: "design_system_id_col",
      createdAt: "created_at_col",
      updatedAt: "updated_at_col",
      visibility: "visibility_col",
      data: "data_col",
    },
    deckShares: {},
  },
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => requestUserEmail,
}));

vi.mock("@agent-native/core/db", () => ({
  isPostgres: () => false,
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: () => ({ allowed: true }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...values: unknown[]) => ({ and: values }),
  desc: (value: unknown) => ({ desc: value }),
  eq: (column: unknown, value: unknown) => ({ column, value }),
  gt: (column: unknown, value: unknown) => ({ gt: [column, value] }),
  lt: (column: unknown, value: unknown) => ({ lt: [column, value] }),
  or: (...values: unknown[]) => ({ or: values }),
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

import action from "./list-decks";

beforeEach(() => {
  vi.clearAllMocks();
  requestUserEmail = "alice@example.com";
  vi.stubEnv("APP_URL", "https://slides.agent.test");
});

describe("list-decks", () => {
  it("returns canonical deck URLs for A2A artifact verification", async () => {
    const result = await action.run({});

    expect(result).toMatchObject({
      count: 1,
      decks: [
        {
          id: "deck_123",
          title: "Roadmap",
          url: "https://slides.agent.test/deck/deck_123",
          appUrl: "https://slides.agent.test/deck/deck_123",
        },
      ],
    });
    expect(result).not.toHaveProperty("nextCursor");
    expect(selectFn).toHaveBeenCalledWith({
      id: "id_col",
      title: "title_col",
      ownerEmail: "owner_email_col",
      designSystemId: "design_system_id_col",
      createdAt: "created_at_col",
      updatedAt: "updated_at_col",
      visibility: "visibility_col",
    });
    expect(result.decks[0]).not.toHaveProperty("slideCount");
  });

  it("keeps compact output metadata-only", async () => {
    const result = await action.run({ compact: "true" });

    expect(result.decks[0]).toMatchObject({
      id: "deck_123",
      url: "https://slides.agent.test/deck/deck_123",
    });
    expect(result.decks[0]).not.toHaveProperty("slideCount");
  });

  it("only reads deck bodies when full slides are explicitly requested", async () => {
    const result = await action.run({ includeSlides: "true" });

    expect(selectFn).toHaveBeenCalledWith();
    expect(result.decks[0]).toMatchObject({
      id: "deck_123",
      slides: [{ id: "slide-1" }],
      createdByMe: true,
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
      ownerEmail: "owner_email_col",
    });
    expect(result.decks[0]).toMatchObject({
      id: "deck_123",
      createdByMe: true,
    });
    expect(result.decks[0]).not.toHaveProperty("ownerEmail");
    expect(result.count).toBe(1);
  });

  it("can include only the first slide as a light-mode preview", async () => {
    const result = await action.run({
      light: "true",
      includePreview: "true",
    });

    expect(selectFn).toHaveBeenCalledWith({
      id: "id_col",
      title: "title_col",
      updatedAt: "updated_at_col",
      visibility: "visibility_col",
      ownerEmail: "owner_email_col",
      previewSlide: expect.objectContaining({
        strings: expect.arrayContaining(["json_extract("]),
      }),
      aspectRatio: expect.objectContaining({
        strings: expect.arrayContaining(["json_extract("]),
      }),
    });
    expect(result.decks[0]).toMatchObject({
      id: "deck_123",
      previewSlide: { id: "slide-1" },
      aspectRatio: "4:3",
    });
    expect(result.decks[0]).not.toHaveProperty("slides");
  });

  it("can limit results to decks created by the current user", async () => {
    await action.run({ createdBy: "me" });

    expect(whereFn).toHaveBeenCalledWith({
      and: [
        { allowed: true },
        {
          strings: ["lower(trim(", ")) = ", ""],
          values: ["owner_email_col", "alice@example.com"],
        },
      ],
    });
  });

  it("returns a cursor only for paginated calls with another page", async () => {
    deckRows = [
      ...deckRows,
      {
        ...deckRows[0],
        id: "deck_124",
        updatedAt: "2026-05-02T00:00:00.000Z",
      },
    ];

    const result = await action.run({ limit: 1 });

    expect(result.decks).toHaveLength(1);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(limitFn).toHaveBeenCalledWith(2);
  });

  it("rejects malformed opaque cursors", async () => {
    await expect(action.run({ cursor: "not-a-cursor" })).rejects.toThrow(
      "Invalid cursor",
    );
  });

  it("does not bypass Mine filtering for a whitespace-only identity", async () => {
    requestUserEmail = "   ";

    await expect(action.run({ createdBy: "me" })).resolves.toEqual({
      count: 0,
      decks: [],
    });
    expect(selectFn).not.toHaveBeenCalled();
  });
});
