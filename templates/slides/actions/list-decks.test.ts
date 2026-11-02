import { registerErrorCaptureProvider } from "@agent-native/core/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deckRows: Array<Record<string, unknown> & { id: string; data: string }> =
  [
    {
      id: "deck_123",
      title: "Roadmap",
      data: JSON.stringify({ slides: [{ id: "slide-1" }] }),
      previewSlide: JSON.stringify({ id: "slide-1" }),
      previewTooLarge: false,
      aspectRatio: "4:3",
      slideCount: 1,
      visibility: "private",
      designSystemId: null,
      ownerEmail: "Alice@Example.com",
      createdAt: "2026-05-03T00:00:00.000Z",
      updatedAt: "2026-05-03T00:00:00.000Z",
    },
  ];

/** A row saved before the list columns existed. */
function legacyRow(
  overrides: Record<string, unknown> & { data: string },
): (typeof deckRows)[number] {
  return {
    ...deckRows[0],
    id: "deck_123",
    previewSlide: null,
    previewTooLarge: null,
    aspectRatio: null,
    slideCount: null,
    ...overrides,
  };
}

let requestUserEmail = "alice@example.com";
let rowsForQuery = deckRows;

const limitFn = vi.fn(async (limit: number) => rowsForQuery.slice(0, limit));
const orderByFn = vi.fn(() =>
  Object.assign(Promise.resolve(rowsForQuery), { limit: limitFn }),
);
let currentSelection: Record<string, unknown> | undefined;
const badPreviewIds = new Set<string>();
let legacyQueryError: Error | null = null;
const previewFor = (data: string) => {
  const parsed = JSON.parse(data);
  const first = parsed.slides?.[0];
  return {
    previewSlide: first === undefined ? null : JSON.stringify(first),
    previewTooLarge: false,
    aspectRatio: parsed.aspectRatio ?? null,
  };
};
const jsonCastError = () =>
  Object.assign(new Error("invalid input syntax for type json"), {
    code: "22P02",
  });
type LookupCondition = {
  column?: unknown;
  value?: unknown;
  inArray?: unknown[];
  and?: unknown[];
};

// Legacy preview reads wrap their lookup in and(lookup, accessFilter(...)).
function lookupOf(condition?: LookupCondition): LookupCondition | undefined {
  if (!condition?.and) return condition;
  return condition.and.find(
    (part): part is LookupCondition =>
      typeof part === "object" &&
      part !== null &&
      ("inArray" in part || (part as LookupCondition).column === "id_col"),
  );
}

const whereFn = vi.fn((rawCondition?: LookupCondition) => {
  const condition = lookupOf(rawCondition) ?? rawCondition;
  const isRowLookup = condition?.column === "id_col";
  const legacyIds = condition?.inArray;
  const rows = isRowLookup
    ? rowsForQuery.filter((row) => row.id === condition.value)
    : legacyIds
      ? rowsForQuery.filter((row) => legacyIds.includes(row.id))
      : rowsForQuery;
  const isLegacyLookup = legacyIds !== undefined;
  const result: Promise<unknown[]> = isLegacyLookup
    ? legacyQueryError
      ? Promise.reject(legacyQueryError)
      : rows.some((row) => badPreviewIds.has(row.id))
        ? Promise.reject(jsonCastError())
        : Promise.resolve(
            rows.map((row) => ({ id: row.id, ...previewFor(row.data) })),
          )
    : !isRowLookup
      ? Promise.resolve(rows)
      : currentSelection && "data" in currentSelection
        ? Promise.resolve(rows.map((row) => ({ data: row.data })))
        : rows.some((row) => badPreviewIds.has(row.id))
          ? Promise.reject(jsonCastError())
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
      previewSlide: "preview_slide_col",
      previewTooLarge: "preview_too_large_col",
      aspectRatio: "aspect_ratio_col",
      slideCount: "slide_count_col",
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
  inArray: (column: unknown, values: unknown[]) => ({
    inArrayColumn: column,
    inArray: values,
  }),
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

import action from "./list-decks";

const legacyLookups = () =>
  whereFn.mock.calls
    .map(([condition]) => [lookupOf(condition)])
    .filter(([condition]) => Array.isArray(condition?.inArray));

beforeEach(() => {
  vi.clearAllMocks();
  badPreviewIds.clear();
  legacyQueryError = null;
  requestUserEmail = "alice@example.com";
  rowsForQuery = deckRows;
  vi.stubEnv("APP_URL", "https://slides.agent.test");
});

describe("list-decks", () => {
  it("exposes this listing action to read-only OAuth clients", () => {
    expect(action.readOnly).toBe(true);
    expect(action.mcpAnnotations?.readOnlyHint).toBe(true);
  });

  it("reads gallery previews from stored columns without parsing deck bodies", async () => {
    const result = await action.run({ limit: 12, includePreview: "true" });
    expect(limitFn).toHaveBeenCalledWith(13);
    const selection = selectFn.mock.calls.at(0)?.[0];
    if (!selection) throw new Error("expected a list projection");
    expect(selection).not.toHaveProperty("data");
    expect(selection).toMatchObject({
      previewSlide: "preview_slide_col",
      previewTooLarge: "preview_too_large_col",
      aspectRatio: "aspect_ratio_col",
      slideCount: "slide_count_col",
    });
    expect(selectFn).toHaveBeenCalledTimes(1);
    expect(legacyLookups()).toHaveLength(0);
    expect(result.decks[0]).toMatchObject({
      previewSlide: { id: "slide-1" },
      aspectRatio: "4:3",
    });
    expect(result.decks[0]).not.toHaveProperty("slides");
  });

  it("parses only the rows saved before the list columns existed", async () => {
    rowsForQuery = [
      deckRows[0],
      legacyRow({
        id: "deck_legacy",
        data: JSON.stringify({
          slides: [{ id: "legacy-1" }],
          aspectRatio: "16:9",
        }),
      }),
    ];

    const result = await action.run({ limit: 12, includePreview: "true" });

    expect(legacyLookups()).toEqual([
      [{ inArrayColumn: "id_col", inArray: ["deck_legacy"] }],
    ]);
    const legacyWhere = whereFn.mock.calls
      .map(([condition]) => condition)
      .find((condition) => Array.isArray(lookupOf(condition)?.inArray));
    expect(legacyWhere?.and).toContainEqual({ allowed: true });
    expect(result.decks).toEqual([
      expect.objectContaining({
        id: "deck_123",
        previewSlide: { id: "slide-1" },
      }),
      expect.objectContaining({
        id: "deck_legacy",
        previewSlide: { id: "legacy-1" },
        aspectRatio: "16:9",
      }),
    ]);
  });

  it("filters to requested deck ids and sizes the page to them", async () => {
    await action.run({
      light: "true",
      includePreview: "true",
      ids: ["deck_123", "deck_456"],
    });

    expect(limitFn).toHaveBeenCalledWith(3);
    const pagedWhere = whereFn.mock.calls.at(0)?.[0] as {
      and?: unknown[];
    };
    expect(pagedWhere.and).toEqual(
      expect.arrayContaining([
        { inArrayColumn: "id_col", inArray: ["deck_123", "deck_456"] },
      ]),
    );
  });

  it("keeps a paged gallery readable when one legacy deck has malformed JSON", async () => {
    const goodRow = legacyRow({
      data: JSON.stringify({
        slides: [{ id: "slide-1" }],
        aspectRatio: "16:9",
      }),
    });
    const badRow = legacyRow({ id: "deck_bad", data: "not json" });
    rowsForQuery = [goodRow, badRow];
    badPreviewIds.add("deck_bad");
    const captured: Array<{ error: unknown; extra: unknown }> = [];
    const unregister = registerErrorCaptureProvider("test", (error, ctx) => {
      captured.push({ error, extra: ctx.extra });
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
      expect(captured.at(-1)?.extra).toMatchObject({ deckId: "deck_bad" });
      const bodyReads = selectFn.mock.calls.filter(([selection]) =>
        Boolean(selection && "data" in selection),
      );
      expect(bodyReads).toHaveLength(1);
    } finally {
      unregister();
    }
  });

  it("flags a first slide that is too large for a gallery preview", async () => {
    const hugeSlide = { id: "slide-1", content: "x".repeat(200 * 1024) };
    rowsForQuery = [
      legacyRow({ data: JSON.stringify({ slides: [hugeSlide] }) }),
    ];
    badPreviewIds.add("deck_123");
    const result = await action.run({ limit: 12, includePreview: "true" });
    expect(result.decks[0]).toMatchObject({ previewTooLarge: true });
    expect(result.decks[0]).not.toHaveProperty("previewSlide");
  });

  it("reports a stored too-large preview without reading the body", async () => {
    rowsForQuery = [
      { ...deckRows[0], previewSlide: null, previewTooLarge: true },
    ];
    const result = await action.run({ limit: 12, includePreview: "true" });
    expect(result.decks[0]).toMatchObject({ previewTooLarge: true });
    expect(result.decks[0]).not.toHaveProperty("previewSlide");
    expect(selectFn).toHaveBeenCalledTimes(1);
  });

  it("applies title search before pagination without reading slide bodies", async () => {
    await action.run({ limit: 30, search: "Road%_map" });
    expect(whereFn).toHaveBeenCalledWith({
      and: [
        { allowed: true },
        undefined,
        expect.objectContaining({ values: ["title_col", "road%_map"] }),
        undefined,
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

  it("pages a light-mode preview listing instead of reading every deck", async () => {
    const result = await action.run({
      light: "true",
      includePreview: "true",
    });

    expect(limitFn).toHaveBeenCalledWith(51);
    expect(result.decks[0]).toMatchObject({
      id: "deck_123",
      previewSlide: { id: "slide-1" },
      aspectRatio: "4:3",
    });
    expect(result.decks[0]).not.toHaveProperty("slides");
  });

  it("falls back when Postgres rejects an unsupported Unicode escape", async () => {
    rowsForQuery = [
      legacyRow({
        data: JSON.stringify({ slides: [{ id: "slide-1", text: "\u0000" }] }),
      }),
    ];
    legacyQueryError = Object.assign(
      new Error("unsupported Unicode escape sequence"),
      { code: "22P05" },
    );

    const result = await action.run({
      light: "true",
      includePreview: "true",
    });

    expect(result.decks[0]?.previewSlide).toEqual({
      id: "slide-1",
      text: "\u0000",
    });
  });

  it("does not fall back on a non-JSON-cast failure, so a real outage isn't doubled with a heavier full-data scan", async () => {
    rowsForQuery = [legacyRow({ data: JSON.stringify({ slides: [] }) })];
    legacyQueryError = Object.assign(new Error("timeout"), { code: "57014" });

    await expect(
      action.run({ light: "true", includePreview: "true" }),
    ).rejects.toThrow("timeout");
    expect(selectFn).toHaveBeenCalledTimes(2);
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
