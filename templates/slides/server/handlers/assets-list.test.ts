import { beforeEach, describe, expect, it, vi } from "vitest";

type Condition =
  | { operator: "and"; conditions: Condition[] }
  | { operator: "eq"; column: string; value: string }
  | { operator: "notLike"; column: string; pattern: string };

const state = vi.hoisted(() => ({
  assets: {
    id: "id",
    url: "url",
    filename: "filename",
    size: "size",
    createdAt: "createdAt",
    ownerEmail: "ownerEmail",
    type: "type",
  },
  rows: [] as Array<Record<string, string | number>>,
  whereCondition: null as Condition | null,
  auth: vi.fn(),
}));

vi.mock("@agent-native/core/file-upload", () => ({ uploadFile: vi.fn() }));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: vi.fn(),
  runWithRequestContext: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: Condition[]): Condition => ({
    operator: "and",
    conditions,
  }),
  desc: (column: string) => ({ operator: "desc", column }),
  eq: (column: string, value: string): Condition => ({
    operator: "eq",
    column,
    value,
  }),
  notLike: (column: string, pattern: string): Condition => ({
    operator: "notLike",
    column,
    pattern,
  }),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => ({
    select: (selection: Record<string, string>) => ({
      from: () => ({
        where: (condition: Condition) => {
          state.whereCondition = condition;
          return {
            orderBy: async () => {
              const matches = (
                predicate: Condition,
                row: Record<string, string | number>,
              ): boolean => {
                if (predicate.operator === "and") {
                  return predicate.conditions.every((item) =>
                    matches(item, row),
                  );
                }
                if (predicate.operator === "eq") {
                  return row[predicate.column] === predicate.value;
                }
                return !String(row[predicate.column]).startsWith(
                  predicate.pattern.slice(0, -1),
                );
              };

              return state.rows
                .filter((row) => matches(condition, row))
                .map((row) =>
                  Object.fromEntries(
                    Object.entries(selection).map(([key, column]) => [
                      key,
                      row[column],
                    ]),
                  ),
                );
            },
          };
        },
      }),
    }),
  }),
  schema: { uploadedAssets: state.assets },
}));

vi.mock("h3", () => ({
  assertBodySize: vi.fn(),
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam: vi.fn(),
  readMultipartFormData: vi.fn(),
  setResponseStatus: vi.fn(),
}));

vi.mock("./request-auth-context.js", () => ({
  resolveSlidesRequestAuth: (...args: unknown[]) => state.auth(...args),
}));

import { listAssets } from "./assets";

describe("listAssets", () => {
  beforeEach(() => {
    state.whereCondition = null;
    state.rows = [
      {
        id: "image-1",
        url: "https://cdn.example.com/slide.png",
        filename: "slide.png",
        size: 123,
        createdAt: "2026-10-07T00:00:00.000Z",
        ownerEmail: "owner@example.com",
        type: "image/png",
      },
      {
        id: "video-1",
        url: "https://cdn.example.com/clip.mp4",
        filename: "clip.mp4",
        size: 456,
        createdAt: "2026-10-07T00:00:00.000Z",
        ownerEmail: "owner@example.com",
        type: "video/mp4",
      },
      {
        id: "other-owner-image",
        url: "https://cdn.example.com/private.png",
        filename: "private.png",
        size: 789,
        createdAt: "2026-10-07T00:00:00.000Z",
        ownerEmail: "other@example.com",
        type: "image/png",
      },
    ];
    state.auth.mockReset();
    state.auth.mockResolvedValue({
      ok: true,
      context: { email: "owner@example.com" },
    });
  });

  it("lists owned images without returning video uploads", async () => {
    const result = await listAssets({} as never);

    expect(state.whereCondition).toEqual({
      operator: "and",
      conditions: [
        {
          operator: "eq",
          column: "ownerEmail",
          value: "owner@example.com",
        },
        {
          operator: "notLike",
          column: "type",
          pattern: "video/%",
        },
      ],
    });
    expect(result).toEqual([
      {
        id: "image-1",
        url: "https://cdn.example.com/slide.png",
        filename: "slide.png",
        size: 123,
        createdAt: "2026-10-07T00:00:00.000Z",
      },
    ]);
  });
});
