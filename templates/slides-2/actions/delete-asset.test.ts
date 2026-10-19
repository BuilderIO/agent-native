import { beforeEach, describe, expect, it, vi } from "vitest";

type Clause =
  | { kind: "and" | "or"; conditions: Clause[] }
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "ne"; column: string; value: unknown }
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
  aliases: [] as Asset[],
  scheduleCleanup: vi.fn(),
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
    case "ne":
      return asset[clause.column as keyof Asset] !== clause.value;
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
  isActionContractError: (error: unknown) =>
    Boolean(
      error &&
      typeof error === "object" &&
      "errorCode" in error &&
      "statusCode" in error,
    ),
  fail: (message: string, details: Record<string, unknown> = {}) => {
    throw Object.assign(new Error(message), details);
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
  ne: (column: string, value: unknown): Clause => ({
    kind: "ne",
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
    transaction: async (run: (tx: unknown) => unknown) => {
      mocks.events.push("transaction-begin");
      const tx = {
        select: (selection: Record<string, string>) => ({
          from: () => ({
            where: (clause: Clause) => ({
              for: async (mode: string) => {
                mocks.events.push(`asset-read-for-${mode}`);
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
      };
      const result = await run(tx);
      mocks.events.push("transaction-commit");
      return result;
    },
  }),
  schema: mocks.schema,
}));

vi.mock("../server/lib/uploaded-asset-cleanup-outbox.js", () => ({
  scheduleUploadedAssetDeletion: (...args: unknown[]) => {
    mocks.events.push("cleanup-schedule");
    return mocks.scheduleCleanup(...args);
  },
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
    mocks.aliases = [];
    mocks.scheduleCleanup.mockResolvedValue("cleanup-1");
    mocks.events.length = 0;
  });

  it("locks the owned asset before queuing cleanup and removing its record", async () => {
    await expect(action.run({ id: "asset-1" } as never)).resolves.toEqual({
      success: true,
    });

    expect(mocks.events).toEqual([
      "transaction-begin",
      "asset-read-for-update",
      "cleanup-schedule",
      "metadata-delete",
      "transaction-commit",
    ]);
    expect(mocks.scheduleCleanup).toHaveBeenCalledWith(expect.any(Object), {
      assetId: "asset-1",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
      provider: "s3",
      providerObjectId: "object-1",
      url: "https://storage.example.test/asset-1.png",
    });
    expect(mocks.asset).toBeNull();
  });

  it("does nothing when a concurrent replacement already removed the source row", async () => {
    mocks.asset = null;

    await expect(action.run({ id: "asset-1" } as never)).resolves.toEqual({
      success: true,
    });

    expect(mocks.events).toEqual([
      "transaction-begin",
      "asset-read-for-update",
      "transaction-commit",
    ]);
    expect(mocks.scheduleCleanup).not.toHaveBeenCalled();
  });

  it("uses the asset's actual workspace scope for a legacy image", async () => {
    mocks.asset = imageAsset({ orgId: null });

    await expect(action.run({ id: "asset-1" } as never)).resolves.toEqual({
      success: true,
    });

    expect(mocks.scheduleCleanup).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ orgId: null }),
    );
    expect(mocks.asset).toBeNull();
  });

  it("schedules cleanup for reaper alias checks when another row references the object", async () => {
    const asset = imageAsset();
    const alias = imageAsset({
      id: "asset-alias",
      url: "https://storage.example.test/asset-alias.png",
      ownerEmail: "another-owner@example.com",
      orgId: "org-2",
      deckId: "deck-1",
    });
    mocks.asset = asset;
    mocks.aliases = [alias];

    await expect(action.run({ id: asset.id } as never)).resolves.toEqual({
      success: true,
    });

    expect(mocks.events).toEqual([
      "transaction-begin",
      "asset-read-for-update",
      "cleanup-schedule",
      "metadata-delete",
      "transaction-commit",
    ]);
    expect(mocks.scheduleCleanup).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ provider: "s3", providerObjectId: "object-1" }),
    );
    expect(mocks.asset).toBeNull();
    expect(mocks.aliases).toEqual([alias]);
  });

  it("preserves provider identity in cleanup when another provider has the same URL", async () => {
    const asset = imageAsset();
    const otherProviderAsset = imageAsset({
      id: "asset-other-provider",
      provider: "gcs",
      providerObjectId: "other-object-1",
      ownerEmail: "another-owner@example.com",
      orgId: "org-2",
      deckId: "deck-1",
    });
    mocks.asset = asset;
    mocks.aliases = [otherProviderAsset];

    await expect(action.run({ id: asset.id } as never)).resolves.toEqual({
      success: true,
    });

    expect(mocks.scheduleCleanup).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ provider: "s3", providerObjectId: "object-1" }),
    );
    expect(mocks.asset).toBeNull();
    expect(mocks.aliases).toEqual([otherProviderAsset]);
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

    expect(mocks.scheduleCleanup).not.toHaveBeenCalled();
    expect(mocks.events).toEqual([
      "transaction-begin",
      "asset-read-for-update",
      "transaction-commit",
    ]);
    expect(mocks.asset).not.toBeNull();
  });

  it("does not remove an image without a configured storage provider", async () => {
    mocks.asset = imageAsset({ provider: null });

    await expect(action.run({ id: "asset-1" } as never)).rejects.toMatchObject({
      errorCode: "asset_delete_storage_unavailable",
      statusCode: 503,
    });

    expect(mocks.scheduleCleanup).not.toHaveBeenCalled();
    expect(mocks.asset).not.toBeNull();
  });

  it("keeps the asset record when cleanup cannot be queued", async () => {
    mocks.scheduleCleanup.mockRejectedValueOnce(new Error("outbox failed"));

    await expect(action.run({ id: "asset-1" } as never)).rejects.toMatchObject({
      errorCode: "asset_delete_failed",
      statusCode: 500,
    });

    expect(mocks.events).toEqual([
      "transaction-begin",
      "asset-read-for-update",
      "cleanup-schedule",
    ]);
    expect(mocks.asset).not.toBeNull();
  });

  it("does not access storage without an authenticated owner", async () => {
    mocks.email = null;

    await expect(action.run({ id: "asset-1" } as never)).rejects.toMatchObject({
      errorCode: "asset_delete_auth_required",
      statusCode: 401,
    });

    expect(mocks.events).toEqual([]);
    expect(mocks.scheduleCleanup).not.toHaveBeenCalled();
  });
});
