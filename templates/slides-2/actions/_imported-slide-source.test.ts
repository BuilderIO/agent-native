import { beforeEach, describe, expect, it, vi } from "vitest";

const mockValues = vi.hoisted(() => vi.fn());
const mockInsert = vi.hoisted(() => vi.fn(() => ({ values: mockValues })));
const mockGetDb = vi.hoisted(() => vi.fn());
const mockExistingAssetRows = vi.hoisted(() => vi.fn());
const mockWhere = vi.hoisted(() =>
  vi.fn((condition: unknown) => mockExistingAssetRows(condition)),
);
const mockFrom = vi.hoisted(() => vi.fn(() => ({ where: mockWhere })));
const mockSelect = vi.hoisted(() => vi.fn(() => ({ from: mockFrom })));
const mockAssetColumns = vi.hoisted(() => ({
  id: "id",
  url: "url",
  ownerEmail: "ownerEmail",
  orgId: "orgId",
}));
const mockCompileSlideSource = vi.hoisted(() =>
  vi.fn(async (_sourceTsx: string, _scope: unknown) => ({
    content: '<div data-compiled="true"></div>',
    sourceHash: "a".repeat(64),
    assetUrls: new Map(),
    assetOrigins: [],
  })),
);

vi.mock("../server/db/index.js", () => ({
  getDb: (...args: unknown[]) => mockGetDb(...args),
  schema: { uploadedAssets: mockAssetColumns },
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ operator: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({ operator: "eq", column, value }),
  inArray: (column: unknown, values: unknown[]) => ({
    operator: "inArray",
    column,
    values,
  }),
  isNull: (column: unknown) => ({ operator: "isNull", column }),
  or: (...conditions: unknown[]) => ({ operator: "or", conditions }),
}));

vi.mock("./_slide-source.js", () => ({
  compileSlideSource: (...args: unknown[]) => mockCompileSlideSource(...args),
}));

import { compileImportedSlideSource } from "./_imported-slide-source.js";

describe("compileImportedSlideSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDb.mockReturnValue({ insert: mockInsert, select: mockSelect });
    mockExistingAssetRows.mockResolvedValue([]);
    mockCompileSlideSource.mockResolvedValue({
      content: '<div data-compiled="true"></div>',
      sourceHash: "a".repeat(64),
      assetUrls: new Map(),
      assetOrigins: [],
    });
  });

  it("registers uploaded images in scope before compiling source-backed slides", async () => {
    const result = await compileImportedSlideSource(
      '<div class="fmd-slide"><img src="https://files.example/photo.png"></div>',
      { ownerEmail: "owner@example.com", orgId: "org-1" },
      [
        {
          url: "https://files.example/photo.png",
          filename: "photo.png",
          mimeType: "image/png",
          size: 1234,
        },
      ],
    );

    const assetId = expect.stringMatching(/^[A-Za-z0-9_-]{10,}$/);
    expect(mockValues).toHaveBeenCalledWith([
      expect.objectContaining({
        id: assetId,
        filename: "photo.png",
        url: "https://files.example/photo.png",
        type: "image/png",
        size: 1234,
        orgId: "org-1",
        ownerEmail: "owner@example.com",
      }),
    ]);
    expect(mockCompileSlideSource).toHaveBeenCalledOnce();
    const [sourceTsx, scope] = mockCompileSlideSource.mock.calls[0]!;
    expect(sourceTsx).toMatch(/src=\{"asset:\/\/[-A-Za-z0-9_]+"\}/);
    expect(scope).toEqual({ ownerEmail: "owner@example.com", orgId: "org-1" });
    expect(result).toMatchObject({
      revision: 1,
      sourceHash: "a".repeat(64),
      content: '<div data-compiled="true"></div>',
    });
  });

  it("rejects an unregistered external image without compiling or persisting", async () => {
    await expect(
      compileImportedSlideSource(
        '<div><img src="https://files.example/missing.png"></div>',
        { ownerEmail: "owner@example.com", orgId: "org-1" },
      ),
    ).rejects.toThrow("must reference an uploaded asset");

    expect(mockValues).not.toHaveBeenCalled();
    expect(mockCompileSlideSource).not.toHaveBeenCalled();
  });

  it("rewrites sidecar image URLs only when a matching asset is in scope", async () => {
    mockExistingAssetRows.mockResolvedValue([
      { id: "existing-image", url: "https://files.example/photo.png" },
    ]);

    const result = await compileImportedSlideSource(
      '<div><img src="https://files.example/photo.png"></div>',
      { ownerEmail: "owner@example.com", orgId: "org-1" },
    );

    const [sourceTsx, scope] = mockCompileSlideSource.mock.calls[0]!;
    expect(sourceTsx).toContain('src={"asset://existing-image"}');
    expect(scope).toEqual({ ownerEmail: "owner@example.com", orgId: "org-1" });
    expect(mockValues).not.toHaveBeenCalled();
    expect(result.revision).toBe(1);
    expect(mockWhere).toHaveBeenCalledWith({
      operator: "and",
      conditions: [
        {
          operator: "inArray",
          column: "url",
          values: ["https://files.example/photo.png"],
        },
        {
          operator: "or",
          conditions: [
            {
              operator: "and",
              conditions: [
                {
                  operator: "eq",
                  column: "ownerEmail",
                  value: "owner@example.com",
                },
                { operator: "eq", column: "orgId", value: "org-1" },
              ],
            },
            { operator: "eq", column: "orgId", value: "org-1" },
          ],
        },
      ],
    });
  });
});
