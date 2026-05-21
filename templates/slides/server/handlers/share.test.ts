import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadBody = vi.hoisted(() => vi.fn());
const mockAssertAccess = vi.hoisted(() => vi.fn());
const mockResolveSlidesRequestAuthContext = vi.hoisted(() => vi.fn());
const mockWithSlidesRequestContext = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const insertedRows = vi.hoisted(() => ({ current: [] as unknown[] }));

const mockInsertValues = vi.hoisted(() =>
  vi.fn(async (row: unknown) => {
    insertedRows.current.push(row);
  }),
);
const mockDeleteWhere = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam: vi.fn(),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  lt: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  readBody: (...args: unknown[]) => mockReadBody(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
  ForbiddenError: class ForbiddenError extends Error {
    statusCode = 403;
  },
}));

vi.mock("../db", () => ({
  getDb: () => ({
    insert: vi.fn(() => ({ values: mockInsertValues })),
    delete: vi.fn(() => ({ where: mockDeleteWhere })),
  }),
  schema: {
    deckShareLinks: {
      token: "token_col",
      title: "title_col",
      slides: "slides_col",
      aspectRatio: "aspect_ratio_col",
      createdAt: "created_at_col",
    },
  },
}));

vi.mock("./request-auth-context.js", () => ({
  resolveSlidesRequestAuthContext: (...args: unknown[]) =>
    mockResolveSlidesRequestAuthContext(...args),
  withSlidesRequestContext: (...args: unknown[]) =>
    mockWithSlidesRequestContext(...args),
}));

import { shareDeck } from "./share";

describe("shareDeck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertedRows.current = [];
    mockReadBody.mockResolvedValue({ deck: { id: "deck-1" } });
    mockResolveSlidesRequestAuthContext.mockResolvedValue({
      email: "owner@example.com",
    });
    mockWithSlidesRequestContext.mockImplementation(async (_event, callback) =>
      callback(),
    );
    mockAssertAccess.mockResolvedValue({
      resource: {
        title: "Launch review",
        data: JSON.stringify({
          aspectRatio: "16:9",
          slides: [
            {
              id: "slide-1",
              content: "<h1>Launch</h1>",
              notes: "internal talking points",
              layout: "title",
              background: "#111",
              transition: "fade",
              splitByParagraph: true,
              animations: [
                {
                  id: "anim-1",
                  elementIndex: 0,
                  elementPath: [1, 0],
                  type: "slide-up",
                },
              ],
            },
          ],
        }),
      },
    });
  });

  it("keeps presentation animation metadata in share snapshots without speaker notes", async () => {
    const result = await shareDeck({} as any);

    expect(result).toEqual({ shareToken: expect.any(String) });
    expect(insertedRows.current).toHaveLength(1);

    const row = insertedRows.current[0] as Record<string, unknown>;
    const slides = JSON.parse(row.slides as string);

    expect(slides).toEqual([
      {
        id: "slide-1",
        content: "<h1>Launch</h1>",
        notes: "",
        layout: "title",
        background: "#111",
        transition: "fade",
        splitByParagraph: true,
        animations: [
          {
            id: "anim-1",
            elementIndex: 0,
            elementPath: [1, 0],
            type: "slide-up",
          },
        ],
      },
    ]);
  });
});
