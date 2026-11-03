import { beforeEach, describe, expect, it, vi } from "vitest";

type Condition =
  | { operator: "and"; conditions: Condition[] }
  | { operator: "or"; conditions: Condition[] }
  | { operator: "eq"; column: string; value: string }
  | { operator: "isNull"; column: string }
  | { operator: "notLike"; column: string; pattern: string };

const state = vi.hoisted(() => ({
  assets: {
    id: "id",
    url: "url",
    filename: "filename",
    size: "size",
    createdAt: "createdAt",
    ownerEmail: "ownerEmail",
    orgId: "orgId",
    type: "type",
    provider: "provider",
    providerObjectId: "providerObjectId",
  },
  rows: [] as Array<Record<string, string | number | null>>,
  whereCondition: null as Condition | null,
  deleteCondition: null as Condition | null,
  auth: vi.fn(),
  routerParam: vi.fn(),
}));

vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: vi.fn(),
  deleteUploadedFile: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: vi.fn(),
  runWithRequestContext: vi.fn((_context: unknown, fn: () => unknown) => fn()),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: Condition[]): Condition => ({
    operator: "and",
    conditions,
  }),
  or: (...conditions: Condition[]): Condition => ({
    operator: "or",
    conditions,
  }),
  desc: (column: string) => ({ operator: "desc", column }),
  eq: (column: string, value: string): Condition => ({
    operator: "eq",
    column,
    value,
  }),
  isNull: (column: string): Condition => ({ operator: "isNull", column }),
  notLike: (column: string, pattern: string): Condition => ({
    operator: "notLike",
    column,
    pattern,
  }),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => {
    const matches = (
      predicate: Condition,
      row: Record<string, string | number | null>,
    ): boolean => {
      if (predicate.operator === "and") {
        return predicate.conditions.every((item) => matches(item, row));
      }
      if (predicate.operator === "or") {
        return predicate.conditions.some((item) => matches(item, row));
      }
      if (predicate.operator === "eq") {
        return row[predicate.column] === predicate.value;
      }
      if (predicate.operator === "isNull") {
        return row[predicate.column] == null;
      }
      if (predicate.operator !== "notLike") return false;
      return !String(row[predicate.column]).startsWith(
        predicate.pattern.slice(0, -1),
      );
    };

    return {
      delete: () => ({
        where: (condition: Condition) => {
          state.deleteCondition = condition;
          state.rows = state.rows.filter((row) => !matches(condition, row));
        },
      }),
      select: (selection: Record<string, string>) => ({
        from: () => ({
          where: (condition: Condition) => {
            state.whereCondition = condition;
            const selectRows = () =>
              state.rows
                .filter((row) => matches(condition, row))
                .map((row) =>
                  Object.fromEntries(
                    Object.entries(selection).map(([key, column]) => [
                      key,
                      row[column],
                    ]),
                  ),
                );
            return {
              limit: async () => selectRows().slice(0, 1),
              orderBy: async () =>
                state.rows
                  .filter((row) => matches(condition, row))
                  .map((row) =>
                    Object.fromEntries(
                      Object.entries(selection).map(([key, column]) => [
                        key,
                        row[column],
                      ]),
                    ),
                  ),
            };
          },
        }),
      }),
    };
  },
  schema: { uploadedAssets: state.assets },
}));

vi.mock("h3", () => ({
  assertBodySize: vi.fn(),
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam: (...args: unknown[]) => state.routerParam(...args),
  readMultipartFormData: vi.fn(),
  setResponseStatus: vi.fn(),
}));

vi.mock("./request-auth-context.js", () => ({
  resolveSlidesRequestAuth: (...args: unknown[]) => state.auth(...args),
}));

import { deleteUploadedFile } from "@agent-native/core/file-upload";
import { setResponseStatus } from "h3";

import { deleteAsset, listAssets } from "./assets";

describe("listAssets", () => {
  beforeEach(() => {
    state.whereCondition = null;
    state.deleteCondition = null;
    state.routerParam.mockReturnValue("image-1");
    vi.mocked(deleteUploadedFile).mockReset();
    vi.mocked(deleteUploadedFile).mockResolvedValue(true);
    vi.mocked(setResponseStatus).mockClear();
    state.rows = [
      {
        id: "image-1",
        url: "https://cdn.example.com/slide.png",
        filename: "slide.png",
        size: 123,
        createdAt: "2026-10-07T00:00:00.000Z",
        ownerEmail: "owner@example.com",
        orgId: "org-1",
        type: "image/png",
        provider: "s3",
        providerObjectId: null,
      },
      {
        id: "video-1",
        url: "https://cdn.example.com/clip.mp4",
        filename: "clip.mp4",
        size: 456,
        createdAt: "2026-10-07T00:00:00.000Z",
        ownerEmail: "owner@example.com",
        orgId: "org-1",
        type: "video/mp4",
      },
      {
        id: "other-owner-image",
        url: "https://cdn.example.com/private.png",
        filename: "private.png",
        size: 789,
        createdAt: "2026-10-07T00:00:00.000Z",
        ownerEmail: "other@example.com",
        orgId: "org-1",
        type: "image/png",
      },
      {
        id: "other-org-image",
        url: "https://cdn.example.com/other-org.png",
        filename: "other-org.png",
        size: 321,
        createdAt: "2026-10-07T00:00:00.000Z",
        ownerEmail: "owner@example.com",
        orgId: "org-2",
        type: "image/png",
      },
      {
        id: "legacy-image",
        url: "https://cdn.example.com/legacy.png",
        filename: "legacy.png",
        size: 654,
        createdAt: "2026-10-06T00:00:00.000Z",
        ownerEmail: "owner@example.com",
        orgId: null,
        type: "image/png",
        provider: "s3",
        providerObjectId: null,
      },
      {
        id: "unrecorded-image",
        url: "https://cdn.example.com/unrecorded.png",
        filename: "unrecorded.png",
        size: 111,
        createdAt: "2026-10-05T00:00:00.000Z",
        ownerEmail: "owner@example.com",
        orgId: "org-1",
        type: "image/png",
        provider: null,
        providerObjectId: null,
      },
    ];
    state.auth.mockReset();
    state.auth.mockResolvedValue({
      ok: true,
      context: { email: "owner@example.com", orgId: "org-1" },
    });
  });

  it("lists owned workspace and legacy images and videos", async () => {
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
          operator: "or",
          conditions: [
            { operator: "eq", column: "orgId", value: "org-1" },
            { operator: "isNull", column: "orgId" },
          ],
        },
      ],
    });
    expect(result).toEqual([
      {
        id: "image-1",
        url: "https://cdn.example.com/slide.png",
        filename: "slide.png",
        type: "image/png",
        size: 123,
        createdAt: "2026-10-07T00:00:00.000Z",
      },
      {
        id: "video-1",
        url: "https://cdn.example.com/clip.mp4",
        filename: "clip.mp4",
        type: "video/mp4",
        size: 456,
        createdAt: "2026-10-07T00:00:00.000Z",
      },
      {
        id: "legacy-image",
        url: "https://cdn.example.com/legacy.png",
        filename: "legacy.png",
        type: "image/png",
        size: 654,
        createdAt: "2026-10-06T00:00:00.000Z",
      },
      {
        id: "unrecorded-image",
        url: "https://cdn.example.com/unrecorded.png",
        filename: "unrecorded.png",
        type: "image/png",
        size: 111,
        createdAt: "2026-10-05T00:00:00.000Z",
      },
    ]);
  });

  it("deletes only an owned image in the active workspace", async () => {
    await deleteAsset({} as never);

    expect(state.deleteCondition).toEqual({
      operator: "and",
      conditions: [
        { operator: "eq", column: "id", value: "image-1" },
        {
          operator: "eq",
          column: "ownerEmail",
          value: "owner@example.com",
        },
        {
          operator: "or",
          conditions: [
            { operator: "eq", column: "orgId", value: "org-1" },
            { operator: "isNull", column: "orgId" },
          ],
        },
      ],
    });
    expect(state.rows.some((row) => row.id === "image-1")).toBe(false);
    expect(state.rows.some((row) => row.id === "other-org-image")).toBe(true);
    expect(state.rows.some((row) => row.id === "other-owner-image")).toBe(true);
  });

  it("lets the owner delete legacy assets without a workspace id", async () => {
    state.routerParam.mockReturnValue("legacy-image");

    await deleteAsset({} as never);

    expect(state.deleteCondition).toEqual({
      operator: "and",
      conditions: [
        { operator: "eq", column: "id", value: "legacy-image" },
        {
          operator: "eq",
          column: "ownerEmail",
          value: "owner@example.com",
        },
        {
          operator: "or",
          conditions: [
            { operator: "eq", column: "orgId", value: "org-1" },
            { operator: "isNull", column: "orgId" },
          ],
        },
      ],
    });
    expect(state.rows.some((row) => row.id === "legacy-image")).toBe(false);
    expect(state.rows.some((row) => row.id === "other-org-image")).toBe(true);
    expect(state.rows.some((row) => row.id === "other-owner-image")).toBe(true);
  });

  it("removes the stored file for an owned asset", async () => {
    await deleteAsset({} as never);

    expect(deleteUploadedFile).toHaveBeenCalledWith("s3", {
      url: "https://cdn.example.com/slide.png",
    });
    expect(state.rows.some((row) => row.id === "image-1")).toBe(false);
  });

  it("returns 404 for a missing asset and deletes nothing", async () => {
    state.routerParam.mockReturnValue("made-up-id");

    const result = await deleteAsset({} as never);

    expect(setResponseStatus).toHaveBeenCalledWith({}, 404);
    expect(result).toEqual({ error: expect.any(String) });
    expect(deleteUploadedFile).not.toHaveBeenCalled();
  });

  it("returns 403 for another owner's asset and leaves it untouched", async () => {
    state.routerParam.mockReturnValue("other-owner-image");

    const result = await deleteAsset({} as never);

    expect(setResponseStatus).toHaveBeenCalledWith({}, 403);
    expect(result).toEqual({ error: expect.any(String) });
    expect(deleteUploadedFile).not.toHaveBeenCalled();
    expect(state.rows.some((row) => row.id === "other-owner-image")).toBe(true);
  });

  it("removes a row whose provider was never recorded and says the file remains", async () => {
    state.routerParam.mockReturnValue("unrecorded-image");

    const result = await deleteAsset({} as never);

    expect(deleteUploadedFile).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, storageDeleted: false });
    expect(state.rows.some((row) => row.id === "unrecorded-image")).toBe(false);
  });

  it("keeps the row and reports failure when the stored file cannot be deleted", async () => {
    vi.mocked(deleteUploadedFile).mockResolvedValue(false);

    const result = await deleteAsset({} as never);

    expect(setResponseStatus).toHaveBeenCalledWith({}, 502);
    expect(result).toEqual({ error: expect.any(String) });
    expect(state.rows.some((row) => row.id === "image-1")).toBe(true);
  });

  it("limits asset reads to unscoped uploads without an active workspace", async () => {
    state.auth.mockResolvedValue({
      ok: true,
      context: { email: "owner@example.com" },
    });

    await listAssets({} as never);

    expect(state.whereCondition).toEqual({
      operator: "and",
      conditions: [
        {
          operator: "eq",
          column: "ownerEmail",
          value: "owner@example.com",
        },
        { operator: "isNull", column: "orgId" },
      ],
    });
  });
});
