import { registerErrorCaptureProvider } from "@agent-native/core/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deckRows = [
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
let rowsForQuery = deckRows;

const limitFn = vi.fn(async (limit: number) => rowsForQuery.slice(0, limit));
const orderByFn = vi.fn(() =>
  Object.assign(Promise.resolve(rowsForQuery), { limit: limitFn }),
);
let currentSelection: Record<string, unknown> | undefined;
const badPreviewIds = new Set<string>();
const previewFor = (data: string) => {
  const parsed = JSON.parse(data);
  const first = parsed.slides?.[0];
  return {
    previewSlide: first === undefined ? null : JSON.stringify(first),
    previewTooLarge: false,
    aspectRatio: parsed.aspectRatio ?? null,
  };
};
const whereFn = vi.fn((condition?: { column?: unknown; value?: unknown }) => {
  const isRowLookup = condition?.column === "id_col";
  const rows = isRowLookup
    ? rowsForQuery.filter((row) => row.id === condition?.value)
    : rowsForQuery;
  const result: Promise<unknown[]> = !isRowLookup
    ? Promise.resolve(rows)
    : currentSelection && "data" in currentSelection
      ? Promise.resolve(rows.map((row) => ({ data: row.data })))
      : rows.some((row) => badPreviewIds.has(row.id))
        ? Promise.reject(
            Object.assign(new Error("invalid input syntax for type json"), {
              code: "22P02",
            }),
          )
        : Promise.resolve(rows.map((row) => previewFor(row.data)));
  return Object.assign(result, { orderBy: orderByFn });
});
const fromFn = vi.fn(() => ({ where: whereFn }));
const selectFn = vi.fn((selection?: Record<string, unknown>) => {
  currentSelection = selection;
  return { from: fromFn };
});
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
  getRequestContext: () => undefined,
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
  badPreviewIds.clear();
  requestUserEmail = "alice@example.com";
  rowsForQuery = deckRows;
  vi.stubEnv("APP_URL", "https://slides.agent.test");
});

describe("list-decks", () => {
  it("returns a bounded preview gallery without selecting complete decks", async () => {
    const result = await action.run({ limit: 12, includePreview: "true" });
    expect(limitFn).toHaveBeenCalledWith(13);
    expect(selectFn.mock.calls[0][0]).not.toHaveProperty("data");
    expect(selectFn.mock.calls[0][0]).toHaveProperty("previewSlide");
    expect(result.decks[0]).toMatchObject({
      previewSlide: { id: "slide-1" },
      aspectRatio: "4:3",
    });
    expect(result.decks[0]).not.toHaveProperty("slides");
  });
  it("keeps a paged gallery readable when one legacy deck has malformed JSON", async () => {
    const goodRow = {
      ...deckRows[0],
      data: JSON.stringify({
        slides: [{ id: "slide-1" }],
        aspectRatio: "16:9",
      }),
    };
    const badRow = { ...deckRows[0], id: "deck_bad", data: "not json" };
    rowsForQuery = [goodRow, badRow];
    badPreviewIds.add("deck_bad");
    limitFn.mockImplementationOnce(() =>
      Promise.reject(
        Object.assign(new Error("invalid input syntax for type json"), {
          code: "22P02",
        }),
      ),
    );
    const captured: unknown[] = [];
    const unregister = registerErrorCaptureProvider("test", (error) => {
      captured.push(error);
    });
    try {
      const result = await action.run({ limit: 12, includePreview: "true" });
      expect(result.count).toBe(2);
      expect(result.decks[0]).toMatchObject({
        previewSlide: { id: "slide-1" },
        aspectRatio: "16:9",
      });
      expect(result.decks[1]).toMatchObject({ id: "deck_bad" });
      expect(result.decks[1]).not.toHaveProperty("previewSlide");
      expect(captured.length).toBeGreaterThan(0);
      const bodyReads = whereFn.mock.calls.filter(
        (_call, index) => "data" in (selectFn.mock.calls[index]?.[0] ?? {}),
      );
      expect(bodyReads).toHaveLength(1);
    } finally {
      unregister();
    }
  });

  it("flags a first slide that is too large for a gallery preview", async () => {
    const hugeSlide = { id: "slide-1", content: "x".repeat(200 * 1024) };
    rowsForQuery = [
      { ...deckRows[0], data: JSON.stringify({ slides: [hugeSlide] }) },
    ];
    badPreviewIds.add("deck_123");
    limitFn.mockImplementationOnce(() =>
      Promise.reject(
        Object.assign(new Error("invalid input syntax for type json"), {
          code: "22P02",
        }),
      ),
    );
    const result = await action.run({ limit: 12, includePreview: "true" });
    expect(result.decks[0]).toMatchObject({ previewTooLarge: true });
    expect(result.decks[0]).not.toHaveProperty("previewSlide");
  });

  it("applies title search before pagination without reading slide bodies", async () => {
    await action.run({ limit: 30, search: "Road%_map" });
    expect(whereFn).toHaveBeenCalledWith({
      and: [
        { allowed: true },
        undefined,
        expect.objectContaining({ values: ["title_col", "road%_map"] }),
      ],
    });
    expect(selectFn.mock.calls[0][0]).not.toHaveProperty("data");
    expect(limitFn).toHaveBeenCalledWith(31);
  });

  it("returns canonical deck URLs for A2A artifact verification", async () => {
    const result = await action.run({});

    expect(result.decks[0]).toMatchObject({
      id: "deck_123",
      title: "Roadmap",
      url: "https://slides.agent.test/deck/deck_123",
    });
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
        strings: expect.arrayContaining([
          "(case when length(",
          expect.stringContaining(" then "),
        ]),
      }),
      previewTooLarge: expect.objectContaining({
        strings: expect.arrayContaining(["(length(", expect.any(String)]),
      }),
      aspectRatio: expect.objectContaining({
        strings: expect.arrayContaining(["::jsonb ->> 'aspectRatio')"]),
      }),
    });
    expect(result.decks[0]).toMatchObject({
      id: "deck_123",
      previewSlide: { id: "slide-1" },
      aspectRatio: "4:3",
    });
    expect(result.decks[0]).not.toHaveProperty("slides");
  });

  it("keeps the list alive when one deck's data fails the SQL preview cast", async () => {
    const goodRow = {
      ...deckRows[0],
      id: "deck_good",
      title: "Good Deck",
      data: JSON.stringify({
        slides: [{ id: "slide-1" }],
        aspectRatio: "16:9",
      }),
      updatedAt: "2026-05-03T00:00:00.000Z",
    };
    const badRow = {
      ...deckRows[0],
      id: "deck_bad",
      title: "Corrupted Deck",
      data: "not json",
      updatedAt: "2026-05-02T00:00:00.000Z",
    };
    rowsForQuery = [goodRow, badRow];
    orderByFn.mockImplementationOnce(() =>
      Promise.reject(
        Object.assign(new Error("invalid input syntax for type json"), {
          code: "22P02",
        }),
      ),
    );
    const captured: Array<{ error: unknown; extra: unknown }> = [];
    const unregister = registerErrorCaptureProvider("test", (error, ctx) => {
      captured.push({ error, extra: ctx.extra });
    });

    try {
      const result = await action.run({
        light: "true",
        includePreview: "true",
      });

      expect(result.count).toBe(2);
      expect(result.decks.find((d) => d.id === "deck_good")).toMatchObject({
        previewSlide: { id: "slide-1" },
        aspectRatio: "16:9",
      });
      const badDeck = result.decks.find((d) => d.id === "deck_bad");
      expect(badDeck).toMatchObject({
        id: "deck_bad",
        title: "Corrupted Deck",
      });
      expect(badDeck).not.toHaveProperty("previewSlide");
      expect(captured).toHaveLength(2);
      expect(captured[1]?.extra).toMatchObject({ deckId: "deck_bad" });
    } finally {
      unregister();
    }
  });

  it("falls back when Postgres rejects an unsupported Unicode escape", async () => {
    rowsForQuery = [
      {
        ...deckRows[0],
        data: JSON.stringify({ slides: [{ id: "slide-1", text: "\u0000" }] }),
      },
    ];
    orderByFn.mockImplementationOnce(() =>
      Promise.reject(
        Object.assign(new Error("unsupported Unicode escape sequence"), {
          code: "22P05",
        }),
      ),
    );

    const result = await action.run({
      light: "true",
      includePreview: "true",
    });

    expect(result.decks[0]?.previewSlide).toEqual({
      id: "slide-1",
      text: "\u0000",
    });
    expect(selectFn).toHaveBeenCalledTimes(2);
  });

  it("does not fall back on a non-JSON-cast failure, so a real outage isn't doubled with a heavier full-data scan", async () => {
    orderByFn.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new Error("timeout"), { code: "57014" })),
    );

    await expect(
      action.run({ light: "true", includePreview: "true" }),
    ).rejects.toThrow("timeout");
    expect(selectFn).toHaveBeenCalledTimes(1);
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
        undefined,
      ],
    });
  });

  it("returns bounded metadata pages with an opaque cursor", async () => {
    rowsForQuery = [
      ...deckRows,
      {
        ...deckRows[0],
        id: "deck_122",
        title: "Earlier",
        updatedAt: "2026-05-02T00:00:00.000Z",
      },
    ];

    const result = await action.run({ limit: 1 });

    expect(limitFn).toHaveBeenCalledWith(2);
    expect(result).toMatchObject({
      count: 1,
      decks: [
        { id: "deck_123", appUrl: "https://slides.agent.test/deck/deck_123" },
      ],
      nextCursor: Buffer.from(
        JSON.stringify({
          updatedAt: "2026-05-03T00:00:00.000Z",
          id: "deck_123",
        }),
      ).toString("base64url"),
    });
  });

  it("normalizes offset timestamps before incremental sync comparisons", async () => {
    await action.run({
      updatedSince: "2026-05-03T00:00:00-07:00",
      limit: 1,
    });

    const pagedWhere = whereFn.mock.calls.at(-1)?.[0] as {
      and?: Array<{ values?: unknown[] }>;
    };
    expect(pagedWhere.and).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          values: ["updated_at_col", "2026-05-03T07:00:00.000Z"],
        }),
      ]),
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
