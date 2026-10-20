import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks, tables } = vi.hoisted(() => ({
  mocks: {
    assertAccess: vi.fn(),
    notifyClients: vi.fn(),
    deleteUploadedFile: vi.fn(),
    finishUploadedAssetCleanup: vi.fn(),
    retryUploadedAssetCleanup: vi.fn(),
    scheduleUploadedAssetDeletion: vi.fn(),
    ForbiddenError: class ForbiddenError extends Error {},
  },
  tables: {
    deckShares: {
      principalId: "principalId",
      principalType: "principalType",
      resourceId: "resourceId",
    },
    deckVersions: { deckId: "deckId", ownerEmail: "ownerEmail" },
    deckShareLinks: {
      token: "token",
      title: "title",
      slides: "slides",
      aspectRatio: "aspectRatio",
      designSystemData: "designSystemData",
      deckId: "deckId",
      createdAt: "createdAt",
    },
    slideComments: { deckId: "deckId" },
    deckEvents: { deckId: "deckId" },
    deckAccessRequestLimits: { deckId: "deckId" },
    uploadedAssets: {
      deckId: "deckId",
      id: "id",
      orgId: "orgId",
      ownerEmail: "ownerEmail",
      provider: "provider",
      providerObjectId: "providerObjectId",
      url: "url",
    },
    uploadedAssetCleanupOutbox: {
      id: "cleanup.id",
      ownerEmail: "cleanup.ownerEmail",
      orgId: "cleanup.orgId",
      provider: "cleanup.provider",
      providerObjectId: "cleanup.providerObjectId",
      url: "cleanup.url",
    },
    decks: {
      id: "id",
      data: "data",
      ownerEmail: "ownerEmail",
      orgId: "orgId",
    },
  },
}));

let shareRows: Array<{ principalType: string; principalId: string }> = [];
let shareLinkRows: Array<{
  token: string;
  title: string;
  slides: string;
  aspectRatio: string | null;
  designSystemData: string | null;
  deckId: string | null;
  createdAt: string;
}> = [];
let assetRows: Array<{
  id: string;
  url: string;
  provider: string | null;
  providerObjectId: string | null;
  orgId: string | null;
  ownerEmail: string;
  deckId: string | null;
}> = [];
let deleteWhereCalls: Array<{ table: unknown; condition: unknown }> = [];
let lockedDeckData = JSON.stringify({ appId: "slides-2" });
let uploadedAssetSelectCount = 0;
let deckSelectCount = 0;
let selectTableOrder: unknown[] = [];
let assetRegisteredOnDeckLock: {
  id: string;
  url: string;
  provider: string | null;
  providerObjectId: string | null;
  orgId: string | null;
  ownerEmail: string;
  deckId: string | null;
} | null = null;
let otherDeckRows: Array<{
  id: string;
  data: unknown;
  ownerEmail: string;
  orgId: string | null;
}> = [];

function selectBuilder() {
  let value: unknown[] = shareRows;
  let selectedTable: unknown;
  const builder = {
    from: vi.fn((table: unknown) => {
      selectedTable = table;
      selectTableOrder.push(table);
      value =
        table === tables.decks
          ? deckSelectCount++ === 0
            ? [
                {
                  id: "deck-1",
                  data: lockedDeckData,
                  ownerEmail: "Owner@Example.com",
                  orgId: "org-1",
                },
              ]
            : otherDeckRows
          : table === tables.deckShares
            ? shareRows
            : table === tables.deckShareLinks
              ? shareLinkRows
              : table === tables.uploadedAssets
                ? uploadedAssetSelectCount++ === 0
                  ? assetRows.filter((asset) => asset.deckId === "deck-1")
                  : assetRows
                : [];
      return builder;
    }),
    where: vi.fn((condition: unknown) => {
      if (
        selectedTable === tables.deckShareLinks &&
        typeof condition === "object" &&
        condition !== null &&
        "left" in condition &&
        condition.left === tables.deckShareLinks.token &&
        "right" in condition
      ) {
        value = shareLinkRows.filter((link) => link.token === condition.right);
      }
      return builder;
    }),
    orderBy: vi.fn(() => builder),
    for: vi.fn((mode: string) => {
      if (
        selectedTable === tables.decks &&
        mode === "update" &&
        assetRegisteredOnDeckLock
      ) {
        assetRows.push(assetRegisteredOnDeckLock);
        assetRegisteredOnDeckLock = null;
      }
      return builder;
    }),
    limit: vi.fn(async (count = 1) => value.slice(0, count)),
    then: (
      resolve: (nextValue: unknown[]) => unknown,
      reject: (error: unknown) => unknown,
    ) => Promise.resolve(value).then(resolve, reject),
  };
  return builder;
}

const mockDb = {
  select: vi.fn(() => selectBuilder()),
  delete: vi.fn((table: unknown) => {
    let rows: unknown[] = table === tables.decks ? [{ id: "deck-1" }] : [];
    const builder = {
      where: vi.fn((condition: unknown) => {
        deleteWhereCalls.push({ table, condition });
        if (
          table === tables.deckShareLinks &&
          typeof condition === "object" &&
          condition !== null &&
          "left" in condition &&
          condition.left === tables.deckShareLinks.deckId &&
          "right" in condition &&
          condition.right === "deck-1"
        ) {
          rows = shareLinkRows.filter((link) => link.deckId === "deck-1");
          shareLinkRows = shareLinkRows.filter(
            (link) => link.deckId !== "deck-1",
          );
        }
        if (
          table === tables.uploadedAssets &&
          typeof condition === "object" &&
          condition !== null &&
          "left" in condition &&
          condition.left === tables.uploadedAssets.deckId &&
          "right" in condition &&
          condition.right === "deck-1"
        ) {
          rows = assetRows.filter((asset) => asset.deckId === "deck-1");
          assetRows = assetRows.filter((asset) => asset.deckId !== "deck-1");
        }
        return builder;
      }),
      returning: vi.fn(async () => rows),
      then: (
        resolve: (value: unknown[]) => unknown,
        reject: (error: unknown) => unknown,
      ) => Promise.resolve(rows).then(resolve, reject),
    };
    return builder;
  }),
  transaction: vi.fn(async (run: (tx: typeof mockDb) => Promise<unknown>) =>
    run(mockDb),
  ),
  update: vi.fn((table: unknown) => {
    let values: Record<string, unknown> = {};
    let rows: Array<{ id: string }> = [];
    const returning = vi.fn(async () => rows);
    const where = vi.fn((condition: unknown) => {
      if (table === tables.uploadedAssets && values.deckId === null) {
        const conditions = Array.isArray(condition) ? condition : [condition];
        const idCondition = conditions.find(
          (part): part is { left: unknown; right: unknown } =>
            typeof part === "object" &&
            part !== null &&
            "left" in part &&
            part.left === tables.uploadedAssets.id &&
            "right" in part,
        );
        const asset = assetRows.find((item) => item.id === idCondition?.right);
        if (asset) {
          asset.deckId = null;
          rows = [{ id: asset.id }];
        }
      }
      return { returning };
    });
    return {
      set: vi.fn((nextValues: Record<string, unknown>) => {
        values = nextValues;
        return { where };
      }),
    };
  }),
};

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string, options: Record<string, unknown> = {}) => {
    throw Object.assign(new Error(message), {
      name: "ActionContractError",
      actionContractError: true,
      errorCode: options.errorCode ?? "action_failed",
      statusCode: options.statusCode ?? 400,
    });
  },
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
  ForbiddenError: mocks.ForbiddenError,
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (_context: unknown, run: () => unknown) => run(),
}));

vi.mock("@agent-native/core/file-upload", () => ({
  deleteUploadedFile: (...args: unknown[]) => mocks.deleteUploadedFile(...args),
  registerFileUploadProvider: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  asc: (column: unknown) => ({ asc: column }),
  eq: (left: unknown, right: unknown) => ({ left, right }),
  inArray: (column: unknown, values: unknown[]) => ({ column, values }),
  isNull: (column: unknown) => ({ isNull: column }),
  ne: (left: unknown, right: unknown) => ({ not: { left, right } }),
  or: (...conditions: unknown[]) => ({ or: conditions }),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam: (event: { params?: Record<string, string> }, name: string) =>
    event.params?.[name],
  setResponseStatus: (event: { status?: number }, status: number) => {
    event.status = status;
  },
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: tables,
}));

vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: (...args: unknown[]) => mocks.notifyClients(...args),
}));

vi.mock("../server/lib/uploaded-asset-cleanup-outbox.js", () => ({
  finishOwnedUploadedAssetCleanup: (...args: unknown[]) =>
    mocks.finishUploadedAssetCleanup(...args),
  retryOwnedUploadedAssetCleanup: (...args: unknown[]) =>
    mocks.retryUploadedAssetCleanup(...args),
  scheduleUploadedAssetDeletion: (...args: unknown[]) =>
    mocks.scheduleUploadedAssetDeletion(...args),
}));

vi.mock("../server/lib/uploaded-asset-object-lifecycle.js", () => ({
  deleteUploadedAssetObject: async (args: {
    identity: {
      url: string;
      provider: string | null;
      providerObjectId: string | null;
    };
    excludeAssetId?: string;
    deleteObject: () => Promise<boolean>;
    onShared?: (transaction: typeof mockDb) => Promise<void>;
    onAlreadyDeleted?: (transaction: typeof mockDb) => Promise<void>;
    onDeleted?: (transaction: typeof mockDb) => Promise<void>;
  }) => {
    const hasAlias = assetRows.some(
      (asset) =>
        asset.id !== args.excludeAssetId &&
        (asset.url === args.identity.url ||
          (args.identity.provider !== null &&
            args.identity.providerObjectId !== null &&
            asset.provider === args.identity.provider &&
            asset.providerObjectId === args.identity.providerObjectId)),
    );
    const callback = hasAlias ? args.onShared : args.onDeleted;
    if (hasAlias) {
      await callback?.(mockDb);
      return { status: "shared" };
    }
    try {
      if (!(await args.deleteObject())) {
        return {
          status: "failed",
          error: new Error("Storage deletion failed."),
        };
      }
      await callback?.(mockDb);
      return { status: "deleted" };
    } catch (error) {
      return { status: "failed", error };
    }
  },
}));

import { getSharedDeck } from "../server/handlers/share.js";
import deleteDeck from "./delete-deck.js";

describe("deleteDeck", () => {
  beforeEach(() => {
    shareRows = [];
    shareLinkRows = [];
    assetRows = [];
    deleteWhereCalls = [];
    uploadedAssetSelectCount = 0;
    deckSelectCount = 0;
    selectTableOrder = [];
    assetRegisteredOnDeckLock = null;
    otherDeckRows = [];
    lockedDeckData = JSON.stringify({ appId: "slides-2" });
    mocks.assertAccess.mockReset();
    mocks.notifyClients.mockReset();
    mocks.deleteUploadedFile.mockReset();
    mocks.deleteUploadedFile.mockResolvedValue(true);
    mocks.finishUploadedAssetCleanup.mockReset();
    mocks.finishUploadedAssetCleanup.mockResolvedValue(true);
    mocks.retryUploadedAssetCleanup.mockReset();
    mocks.retryUploadedAssetCleanup.mockResolvedValue(true);
    mocks.scheduleUploadedAssetDeletion.mockReset();
    mocks.scheduleUploadedAssetDeletion.mockResolvedValue("cleanup-1");
    mockDb.select.mockClear();
    mockDb.delete.mockClear();
    mockDb.update.mockClear();
    mockDb.transaction.mockClear();
    mocks.assertAccess.mockResolvedValue({
      resource: {
        ownerEmail: "Owner@Example.com",
        orgId: "org-1",
        visibility: "private",
      },
    });
  });

  it("is available to the agent as the same guarded delete action", () => {
    expect(deleteDeck.agentTool).not.toBe(false);
  });

  it("does not read shares or delete a deck explicitly owned by another app", async () => {
    lockedDeckData = JSON.stringify({ appId: "slides" });

    await expect(deleteDeck.run({ id: "foreign-deck" })).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "deck_not_found",
      message: "Deck not found.",
    });

    expect(mockDb.transaction).toHaveBeenCalledOnce();
    expect(mockDb.select).toHaveBeenCalledOnce();
    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(mocks.notifyClients).not.toHaveBeenCalled();
  });

  it("does not delete a markerless legacy deck", async () => {
    lockedDeckData = JSON.stringify({ title: "Legacy deck", slides: [] });

    await expect(deleteDeck.run({ id: "legacy-deck" })).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "deck_not_found",
      message: "Deck not found.",
    });

    expect(mockDb.transaction).toHaveBeenCalledOnce();
    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(mocks.notifyClients).not.toHaveBeenCalled();
  });

  it("targets the owner and pre-delete share audience without leaking private org scope", async () => {
    shareRows = [
      { principalType: "user", principalId: "Sharee@Example.com" },
      { principalType: "org", principalId: "org-2" },
      { principalType: "group", principalId: "group-1" },
    ];

    await deleteDeck.run({ id: "deck-1" });

    expect(mocks.notifyClients.mock.calls).toEqual([
      ["deck-1", { type: "deck-deleted", owner: "owner@example.com" }],
      ["deck-1", { type: "deck-deleted", owner: "sharee@example.com" }],
      ["deck-1", { type: "deck-deleted", orgId: "org-2" }],
    ]);
    expect(mockDb.transaction).toHaveBeenCalledOnce();
    expect(mockDb.delete.mock.calls.map(([table]) => table)).toEqual([
      tables.deckShares,
      tables.deckShareLinks,
      tables.deckEvents,
      tables.deckAccessRequestLimits,
      tables.deckVersions,
      tables.uploadedAssets,
      tables.slideComments,
      tables.decks,
    ]);
    expect(deleteWhereCalls).toContainEqual({
      table: tables.deckShareLinks,
      condition: { left: tables.deckShareLinks.deckId, right: "deck-1" },
    });
    expect(deleteWhereCalls).toContainEqual({
      table: tables.deckEvents,
      condition: { left: tables.deckEvents.deckId, right: "deck-1" },
    });
    expect(deleteWhereCalls).toContainEqual({
      table: tables.deckAccessRequestLimits,
      condition: {
        left: tables.deckAccessRequestLimits.deckId,
        right: "deck-1",
      },
    });
  });

  it("revokes linked shares while legacy unlinked shares remain readable until expiry", async () => {
    const now = new Date().toISOString();
    shareLinkRows = [
      {
        token: "legacy-token",
        title: "Legacy presentation",
        slides: "[]",
        aspectRatio: "16:9",
        designSystemData: null,
        deckId: null,
        createdAt: now,
      },
      {
        token: "linked-token",
        title: "Linked presentation",
        slides: "[]",
        aspectRatio: "16:9",
        designSystemData: null,
        deckId: "deck-1",
        createdAt: now,
      },
    ];

    await deleteDeck.run({ id: "deck-1" });

    const legacyEvent: { params: Record<string, string>; status?: number } = {
      params: { token: "legacy-token" },
    };
    await expect(getSharedDeck(legacyEvent as never)).resolves.toMatchObject({
      title: "Legacy presentation",
      slides: [],
    });
    expect(legacyEvent.status).toBeUndefined();

    const linkedEvent: { params: Record<string, string>; status?: number } = {
      params: { token: "linked-token" },
    };
    await expect(getSharedDeck(linkedEvent as never)).resolves.toMatchObject({
      error: "Shared presentation not found or has expired",
    });
    expect(linkedEvent.status).toBe(404);

    shareLinkRows[0] = {
      ...shareLinkRows[0]!,
      createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const expiredLegacyEvent: {
      params: Record<string, string>;
      status?: number;
    } = { params: { token: "legacy-token" } };
    await getSharedDeck(expiredLegacyEvent as never);
    expect(expiredLegacyEvent.status).toBe(404);
  });

  it("removes deck assets and reaps their provider objects after commit", async () => {
    assetRows = [
      {
        id: "asset-1",
        url: "https://cdn.example.com/deck-image.png",
        provider: "s3",
        providerObjectId: "objects/deck-image.png",
        orgId: "org-1",
        ownerEmail: "asset-owner@example.com",
        deckId: "deck-1",
      },
    ];

    await deleteDeck.run({ id: "deck-1" });

    expect(mocks.scheduleUploadedAssetDeletion).toHaveBeenCalledWith(mockDb, {
      ownerEmail: "asset-owner@example.com",
      orgId: "org-1",
      assetId: "asset-1",
      provider: "s3",
      providerObjectId: "objects/deck-image.png",
      url: "https://cdn.example.com/deck-image.png",
    });
    expect(mockDb.delete.mock.calls.map(([table]) => table)).toContain(
      tables.uploadedAssets,
    );
    expect(mocks.deleteUploadedFile).toHaveBeenCalledWith("s3", {
      id: "objects/deck-image.png",
      url: "https://cdn.example.com/deck-image.png",
    });
    expect(mocks.finishUploadedAssetCleanup).toHaveBeenCalledWith(
      mockDb,
      {
        assetId: "asset-1",
        ownerEmail: "asset-owner@example.com",
        orgId: "org-1",
      },
      "cleanup-1",
    );
    expect(assetRows).toEqual([]);
  });

  it("locks the deck before collecting assets registered by an in-flight upload", async () => {
    assetRegisteredOnDeckLock = {
      id: "late-asset",
      url: "https://cdn.example.com/late-image.png",
      provider: "s3",
      providerObjectId: "objects/late-image.png",
      orgId: "org-1",
      ownerEmail: "asset-owner@example.com",
      deckId: "deck-1",
    };

    await deleteDeck.run({ id: "deck-1" });

    expect(selectTableOrder.indexOf(tables.decks)).toBeLessThan(
      selectTableOrder.indexOf(tables.uploadedAssets),
    );
    expect(mocks.scheduleUploadedAssetDeletion).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ assetId: "late-asset" }),
    );
    expect(mocks.deleteUploadedFile).toHaveBeenCalledWith("s3", {
      id: "objects/late-image.png",
      url: "https://cdn.example.com/late-image.png",
    });
    expect(assetRows).toEqual([]);
  });

  it("keeps a deck asset when another saved slide references its handle", async () => {
    const asset = {
      id: "asset-1",
      url: "https://cdn.example.com/deck-image.png",
      provider: "s3",
      providerObjectId: "objects/deck-image.png",
      orgId: "org-1",
      ownerEmail: "asset-owner@example.com",
      deckId: "deck-1",
    };
    assetRows = [asset];
    otherDeckRows = [
      {
        id: "other-deck",
        ownerEmail: "other-owner@example.com",
        orgId: "org-1",
        data: JSON.stringify({
          appId: "slides-2",
          slides: [
            {
              sourceTsx: String.raw`<img src={"asset:\u002f\u002fasset-1"} />`,
            },
          ],
        }),
      },
    ];

    await deleteDeck.run({ id: "deck-1" });

    expect(assetRows).toEqual([{ ...asset, deckId: null }]);
    expect(mockDb.update).toHaveBeenCalledWith(tables.uploadedAssets);
    expect(mocks.scheduleUploadedAssetDeletion).not.toHaveBeenCalled();
    expect(mocks.deleteUploadedFile).not.toHaveBeenCalled();
  });

  it("deletes one provider object for duplicate deck assets with no surviving alias", async () => {
    const shared = {
      url: "https://cdn.example.com/shared-image.png",
      provider: "s3",
      providerObjectId: "objects/shared-image.png",
      orgId: "org-1",
      ownerEmail: "asset-owner@example.com",
      deckId: "deck-1",
    };
    assetRows = [
      { id: "asset-1", ...shared },
      { id: "asset-2", ...shared },
    ];

    await deleteDeck.run({ id: "deck-1" });

    expect(mocks.scheduleUploadedAssetDeletion).toHaveBeenCalledOnce();
    expect(mocks.deleteUploadedFile).toHaveBeenCalledOnce();
    expect(assetRows).toEqual([]);
  });

  it("preserves a shared blob when deleting duplicate deck assets with a surviving global alias", async () => {
    const shared = {
      url: "https://cdn.example.com/shared-image.png",
      provider: "s3",
      providerObjectId: "objects/shared-image.png",
      orgId: "org-1",
      ownerEmail: "asset-owner@example.com",
    };
    const survivingAlias = { id: "global-asset", ...shared, deckId: null };
    assetRows = [
      { id: "deck-asset-1", ...shared, deckId: "deck-1" },
      { id: "deck-asset-2", ...shared, deckId: "deck-1" },
      survivingAlias,
    ];

    await deleteDeck.run({ id: "deck-1" });

    expect(mocks.scheduleUploadedAssetDeletion).not.toHaveBeenCalled();
    expect(mocks.deleteUploadedFile).not.toHaveBeenCalled();
    expect(assetRows).toEqual([survivingAlias]);
    expect(deleteWhereCalls).toContainEqual({
      table: tables.uploadedAssets,
      condition: { left: tables.uploadedAssets.deckId, right: "deck-1" },
    });
  });

  it("keeps SQL cleanup queued when provider deletion is not confirmed", async () => {
    assetRows = [
      {
        id: "asset-1",
        url: "https://cdn.example.com/deck-image.png",
        provider: "s3",
        providerObjectId: "objects/deck-image.png",
        orgId: "org-1",
        ownerEmail: "asset-owner@example.com",
        deckId: "deck-1",
      },
    ];
    mocks.deleteUploadedFile.mockResolvedValueOnce(false);

    await deleteDeck.run({ id: "deck-1" });

    expect(mocks.scheduleUploadedAssetDeletion).toHaveBeenCalledOnce();
    expect(mocks.deleteUploadedFile).toHaveBeenCalledOnce();
    expect(mocks.retryUploadedAssetCleanup).toHaveBeenCalledWith(
      {
        assetId: "asset-1",
        ownerEmail: "asset-owner@example.com",
        orgId: "org-1",
      },
      "cleanup-1",
      1,
    );
    expect(mocks.finishUploadedAssetCleanup).not.toHaveBeenCalled();
  });

  it("preserves the deck when an attached asset has no cleanup provider", async () => {
    assetRows = [
      {
        id: "asset-1",
        url: "https://cdn.example.com/deck-image.png",
        provider: null,
        providerObjectId: null,
        orgId: "org-1",
        ownerEmail: "asset-owner@example.com",
        deckId: "deck-1",
      },
    ];

    await expect(deleteDeck.run({ id: "deck-1" })).rejects.toMatchObject({
      statusCode: 503,
      errorCode: "deck_asset_cleanup_unavailable",
    });

    expect(mocks.scheduleUploadedAssetDeletion).not.toHaveBeenCalled();
    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(mocks.deleteUploadedFile).not.toHaveBeenCalled();
    expect(mocks.notifyClients).not.toHaveBeenCalled();
  });

  it("preserves the deck and its assets when outbox persistence fails", async () => {
    assetRows = [
      {
        id: "asset-1",
        url: "https://cdn.example.com/deck-image.png",
        provider: "s3",
        providerObjectId: "objects/deck-image.png",
        orgId: "org-1",
        ownerEmail: "asset-owner@example.com",
        deckId: "deck-1",
      },
    ];
    mocks.scheduleUploadedAssetDeletion.mockRejectedValueOnce(
      new Error("cleanup outbox unavailable"),
    );

    await expect(deleteDeck.run({ id: "deck-1" })).rejects.toThrow(
      "cleanup outbox unavailable",
    );

    expect(mockDb.transaction).toHaveBeenCalledOnce();
    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(deleteWhereCalls).toEqual([]);
    expect(mocks.scheduleUploadedAssetDeletion).toHaveBeenCalledOnce();
    expect(mocks.deleteUploadedFile).not.toHaveBeenCalled();
    expect(mocks.notifyClients).not.toHaveBeenCalled();
  });

  it("includes the resource organization only for org-visible decks", async () => {
    mocks.assertAccess.mockResolvedValue({
      resource: {
        ownerEmail: "owner@example.com",
        orgId: "org-1",
        visibility: "org",
      },
    });

    await deleteDeck.run({ id: "deck-1" });

    expect(mocks.notifyClients).toHaveBeenCalledWith("deck-1", {
      type: "deck-deleted",
      orgId: "org-1",
    });
  });

  it("broadcasts a public deletion tombstone to public viewers", async () => {
    mocks.assertAccess.mockResolvedValue({
      resource: {
        ownerEmail: "owner@example.com",
        orgId: "org-1",
        visibility: "public",
      },
    });

    await deleteDeck.run({ id: "deck-1" });

    expect(mocks.notifyClients).toHaveBeenCalledWith("deck-1", {
      type: "deck-deleted",
      visibility: "public",
    });
  });

  it("maps denied access to the same typed not-found boundary", async () => {
    mocks.assertAccess.mockRejectedValueOnce(
      new mocks.ForbiddenError("Not allowed"),
    );

    await expect(deleteDeck.run({ id: "private-deck" })).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "deck_not_found",
      message: "Deck not found.",
    });
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });
});
