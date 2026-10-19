import { beforeEach, describe, expect, it, vi } from "vitest";

type Clause =
  | { kind: "and" | "or"; conditions: Clause[] }
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "isNull"; column: string }
  | { kind: "like"; column: string; value: string };

type Asset = {
  id: string;
  url: string;
  provider: string | null;
  providerObjectId: string | null;
  ownerEmail: string;
  orgId: string | null;
  deckId: string | null;
  type: string;
};

const mocks = vi.hoisted(() => ({
  email: "owner@example.com" as string | null,
  orgId: "org-1" as string | null,
  asset: null as Asset | null,
  deleteFile: vi.fn(),
  events: [] as string[],
  schema: {
    uploadedAssets: {
      id: "id",
      url: "url",
      provider: "provider",
      providerObjectId: "providerObjectId",
      ownerEmail: "ownerEmail",
      orgId: "orgId",
      deckId: "deckId",
      type: "type",
    },
  },
}));

function matches(clause: Clause, asset: Asset): boolean {
  switch (clause.kind) {
    case "and":
      return clause.conditions.every((condition) => matches(condition, asset));
    case "or":
      return clause.conditions.some((condition) => matches(condition, asset));
    case "eq":
      return asset[clause.column as keyof Asset] === clause.value;
    case "isNull":
      return asset[clause.column as keyof Asset] == null;
    case "like": {
      const value = asset[clause.column as keyof Asset];
      return (
        typeof value === "string" && value.startsWith(clause.value.slice(0, -1))
      );
    }
  }
}

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string, details: Record<string, unknown> = {}) => {
    throw Object.assign(new Error(message), details);
  },
}));

vi.mock("@agent-native/core/file-upload", () => ({
  deleteUploadedFile: (...args: unknown[]) => {
    mocks.events.push("blob-delete");
    return mocks.deleteFile(...args);
  },
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: () => mocks.orgId,
  getRequestUserEmail: () => mocks.email,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: Clause[]): Clause => ({ kind: "and", conditions }),
  eq: (column: string, value: unknown): Clause => ({
    kind: "eq",
    column,
    value,
  }),
  isNull: (column: string): Clause => ({ kind: "isNull", column }),
  like: (column: string, value: string): Clause => ({
    kind: "like",
    column,
    value,
  }),
  or: (...conditions: Clause[]): Clause => ({ kind: "or", conditions }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: (selection: Record<string, string>) => ({
      from: () => ({
        where: (clause: Clause) => ({
          limit: async () => {
            mocks.events.push("asset-read");
            if (!mocks.asset || !matches(clause, mocks.asset)) return [];
            return [
              Object.fromEntries(
                Object.entries(selection).map(([key, column]) => [
                  key,
                  mocks.asset?.[column as keyof Asset],
                ]),
              ),
            ];
          },
        }),
      }),
    }),
    delete: () => ({
      where: (clause: Clause) => ({
        returning: async (selection: Record<string, string>) => {
          mocks.events.push("metadata-delete");
          if (!mocks.asset || !matches(clause, mocks.asset)) return [];
          const deleted = mocks.asset;
          mocks.asset = null;
          return [
            Object.fromEntries(
              Object.entries(selection).map(([key, column]) => [
                key,
                deleted[column as keyof Asset],
              ]),
            ),
          ];
        },
      }),
    }),
  }),
  schema: mocks.schema,
}));

import action from "./delete-asset.js";

function imageAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "asset-1",
    url: "https://storage.example.test/asset-1.png",
    provider: "s3",
    providerObjectId: "object-1",
    ownerEmail: "owner@example.com",
    orgId: "org-1",
    deckId: null,
    type: "image/png",
    ...overrides,
  };
}

describe("delete-asset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.email = "owner@example.com";
    mocks.orgId = "org-1";
    mocks.asset = imageAsset();
    mocks.events.length = 0;
    mocks.deleteFile.mockResolvedValue(true);
  });

  it("deletes the stored file before removing the owned global image record", async () => {
    await expect(action.run({ id: "asset-1" } as never)).resolves.toEqual({
      success: true,
    });

    expect(mocks.events).toEqual([
      "asset-read",
      "blob-delete",
      "metadata-delete",
    ]);
    expect(mocks.deleteFile).toHaveBeenCalledWith("s3", {
      id: "object-1",
      url: "https://storage.example.test/asset-1.png",
    });
    expect(mocks.asset).toBeNull();
  });

  it("lets the owner delete a legacy image without a workspace id", async () => {
    mocks.asset = imageAsset({ orgId: null });

    await expect(action.run({ id: "asset-1" } as never)).resolves.toEqual({
      success: true,
    });

    expect(mocks.events).toEqual([
      "asset-read",
      "blob-delete",
      "metadata-delete",
    ]);
    expect(mocks.asset).toBeNull();
  });

  it.each<[string, Partial<Asset>]>([
    ["deck-scoped", { deckId: "deck-1" }],
    ["video", { type: "video/mp4" }],
    ["other owner", { ownerEmail: "other@example.com" }],
    ["other workspace", { orgId: "org-2" }],
  ])("does not delete a %s asset", async (_label, overrides) => {
    mocks.asset = imageAsset(overrides);

    await expect(action.run({ id: "asset-1" } as never)).resolves.toEqual({
      success: true,
    });

    expect(mocks.deleteFile).not.toHaveBeenCalled();
    expect(mocks.events).toEqual(["asset-read"]);
    expect(mocks.asset).not.toBeNull();
  });

  it("keeps the asset record when storage does not confirm deletion", async () => {
    mocks.deleteFile.mockResolvedValue(false);

    await expect(action.run({ id: "asset-1" } as never)).rejects.toMatchObject({
      errorCode: "asset_delete_storage_failed",
      statusCode: 503,
    });

    expect(mocks.events).toEqual(["asset-read", "blob-delete"]);
    expect(mocks.asset).not.toBeNull();
  });

  it("keeps an S3 record when its scoped provider object handle is missing", async () => {
    mocks.asset = imageAsset({ provider: "s3", providerObjectId: null });
    mocks.deleteFile.mockResolvedValue(false);

    await expect(action.run({ id: "asset-1" } as never)).rejects.toMatchObject({
      errorCode: "asset_delete_storage_failed",
      statusCode: 503,
    });

    expect(mocks.deleteFile).toHaveBeenCalledWith("s3", {
      id: undefined,
      url: "https://storage.example.test/asset-1.png",
    });
    expect(mocks.asset).not.toBeNull();
    expect(mocks.events).toEqual(["asset-read", "blob-delete"]);
  });

  it("does not access storage without an authenticated owner", async () => {
    mocks.email = null;

    await expect(action.run({ id: "asset-1" } as never)).rejects.toMatchObject({
      errorCode: "asset_delete_auth_required",
      statusCode: 401,
    });

    expect(mocks.events).toEqual([]);
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });
});
