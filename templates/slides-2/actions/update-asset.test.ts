import { beforeEach, describe, expect, it, vi } from "vitest";

type Clause =
  | { kind: "and" | "or"; conditions: Clause[] }
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "isNull"; column: string }
  | { kind: "like"; column: string; value: string }
  | { kind: "inArray"; column: string; values: unknown[] }
  | { kind: "assetReference"; value: string };

type Asset = {
  id: string;
  filename: string;
  url: string;
  type: string;
  size: number;
  provider: string | null;
  providerObjectId: string | null;
  ownerEmail: string;
  orgId: string | null;
  deckId: string | null;
};

type Deck = {
  id: string;
  data: string;
  ownerEmail: string;
  orgId: string | null;
  visibility?: "private" | "org";
};

const mocks = vi.hoisted(() => ({
  email: "owner@example.com" as string | null,
  orgId: "org-1" as string | null,
  assets: [] as Asset[],
  decks: [] as Deck[],
  deleteFile: vi.fn(),
  scheduleCleanup: vi.fn(),
  finishCleanup: vi.fn(),
  retryCleanup: vi.fn(),
  removeReplacementBeforeTransaction: false,
  events: [] as string[],
  schema: {
    uploadedAssets: {
      id: "id",
      filename: "filename",
      url: "url",
      type: "type",
      size: "size",
      provider: "provider",
      providerObjectId: "providerObjectId",
      ownerEmail: "ownerEmail",
      orgId: "orgId",
      deckId: "deckId",
    },
    uploadedAssetCleanupOutbox: {
      id: "cleanup.id",
      ownerEmail: "cleanup.ownerEmail",
      orgId: "cleanup.orgId",
      intent: "cleanup.intent",
      state: "cleanup.state",
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

function matches(clause: Clause, row: Asset | Deck): boolean {
  switch (clause.kind) {
    case "and":
      return clause.conditions.every((condition) => matches(condition, row));
    case "or":
      return clause.conditions.some((condition) => matches(condition, row));
    case "eq":
      return (
        (row as unknown as Record<string, unknown>)[clause.column] ===
        clause.value
      );
    case "isNull":
      return (row as unknown as Record<string, unknown>)[clause.column] == null;
    case "like": {
      const value = (row as unknown as Record<string, unknown>)[clause.column];
      return (
        typeof value === "string" && value.startsWith(clause.value.slice(0, -1))
      );
    }
    case "inArray":
      return clause.values.includes(
        (row as unknown as Record<string, unknown>)[clause.column],
      );
    case "assetReference":
      return "data" in row && row.data.includes(clause.value);
  }
}

function project(row: Asset | Deck, selection: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(selection).map(([key, column]) => [
      key,
      (row as unknown as Record<string, unknown>)[column],
    ]),
  );
}

function makeDb() {
  const select = (selection: Record<string, string>) => ({
    from: (table: unknown) => ({
      where: (clause: Clause) => {
        if (table === mocks.schema.decks) {
          return {
            limit: async (count: number) => {
              mocks.events.push("deck-reference-read");
              return mocks.decks
                .filter((deck) => matches(clause, deck))
                .slice(0, count)
                .map((deck) => project(deck, selection));
            },
          };
        }
        mocks.events.push("asset-read");
        return Promise.resolve(
          mocks.assets
            .filter((asset) => matches(clause, asset))
            .map((asset) => project(asset, selection)),
        );
      },
    }),
  });
  const update = () => ({
    set: (values: Partial<Asset>) => ({
      where: (clause: Clause) => ({
        returning: async (selection: Record<string, string>) => {
          mocks.events.push("asset-update");
          const updated = mocks.assets.filter((asset) =>
            matches(clause, asset),
          );
          for (const asset of updated) Object.assign(asset, values);
          return updated.map((asset) => project(asset, selection));
        },
      }),
    }),
  });
  const remove = (table: unknown) => ({
    where: (clause: Clause) => {
      if (table === mocks.schema.uploadedAssetCleanupOutbox) {
        mocks.events.push("cleanup-marker-delete");
        return Promise.resolve();
      }
      return {
        returning: async (selection: Record<string, string>) => {
          mocks.events.push("asset-row-delete");
          const removed = mocks.assets.filter((asset) =>
            matches(clause, asset),
          );
          mocks.assets = mocks.assets.filter(
            (asset) => !matches(clause, asset),
          );
          return removed.map((asset) => project(asset, selection));
        },
      };
    },
  });
  return {
    select,
    update,
    delete: remove,
    transaction: async (run: (tx: ReturnType<typeof makeDb>) => unknown) => {
      if (mocks.removeReplacementBeforeTransaction) {
        mocks.events.push("concurrent-replacement-delete");
        mocks.assets = mocks.assets.filter((asset) => asset.id !== "asset-2");
      }
      const rollbackState = structuredClone(mocks.assets);
      try {
        return await run(makeDb());
      } catch (error) {
        mocks.assets = rollbackState;
        throw error;
      }
    },
  };
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
  inArray: (column: string, values: unknown[]): Clause => ({
    kind: "inArray",
    column,
    values,
  }),
  isNull: (column: string): Clause => ({ kind: "isNull", column }),
  like: (column: string, value: string): Clause => ({
    kind: "like",
    column,
    value,
  }),
  or: (...conditions: Clause[]): Clause => ({ kind: "or", conditions }),
  sql: (_strings: TemplateStringsArray, ...values: unknown[]): Clause => ({
    kind: "assetReference",
    value: String(values[0]),
  }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => makeDb(),
  schema: mocks.schema,
}));

vi.mock("../server/lib/uploaded-asset-cleanup-outbox.js", () => ({
  scheduleUploadedAssetDeletion: (...args: unknown[]) => {
    mocks.events.push("cleanup-scheduled");
    return mocks.scheduleCleanup(...args);
  },
  finishOwnedUploadedAssetCleanup: (...args: unknown[]) => {
    mocks.events.push("cleanup-finished");
    return mocks.finishCleanup(...args);
  },
  retryOwnedUploadedAssetCleanup: (...args: unknown[]) => {
    mocks.events.push("cleanup-retried");
    return mocks.retryCleanup(...args);
  },
}));

import action from "./update-asset.js";

function imageAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "asset-1",
    filename: "old.png",
    url: "https://storage.example.test/old.png",
    type: "image/png",
    size: 10,
    provider: "s3",
    providerObjectId: "old-object",
    ownerEmail: "owner@example.com",
    orgId: "org-1",
    deckId: null,
    ...overrides,
  };
}

describe("update-asset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.email = "owner@example.com";
    mocks.orgId = "org-1";
    mocks.assets = [
      imageAsset(),
      imageAsset({
        id: "asset-2",
        filename: "new.png",
        url: "https://storage.example.test/new.png",
        providerObjectId: "new-object",
      }),
    ];
    mocks.decks = [];
    mocks.events.length = 0;
    mocks.deleteFile.mockResolvedValue(true);
    mocks.scheduleCleanup.mockReset().mockResolvedValue("cleanup-token");
    mocks.finishCleanup.mockReset().mockResolvedValue(true);
    mocks.retryCleanup.mockReset().mockResolvedValue(true);
    mocks.removeReplacementBeforeTransaction = false;
  });

  it("renames only the caller's global image", async () => {
    await expect(
      action.run({ id: "asset-1", filename: "brand.png" } as never),
    ).resolves.toEqual({ success: true, filename: "brand.png" });

    expect(mocks.assets[0]!.filename).toBe("brand.png");
    expect(mocks.assets[1]!.filename).toBe("new.png");
    expect(mocks.events).toEqual(["asset-update"]);
  });

  it("preserves the asset ID and references while replacing its stored image", async () => {
    await expect(
      action.run({ id: "asset-1", replacementId: "asset-2" } as never),
    ).resolves.toEqual({
      success: true,
      filename: "new.png",
      cleanupWarning: false,
    });

    expect(mocks.assets).toHaveLength(1);
    expect(mocks.assets[0]).toMatchObject({
      id: "asset-1",
      filename: "new.png",
      url: "https://storage.example.test/new.png",
      providerObjectId: "new-object",
    });
    expect(mocks.events).toEqual([
      "asset-read",
      "deck-reference-read",
      "asset-update",
      "asset-row-delete",
      "cleanup-marker-delete",
      "cleanup-scheduled",
      "blob-delete",
      "cleanup-finished",
    ]);
    expect(mocks.deleteFile).toHaveBeenCalledWith("s3", {
      url: "https://storage.example.test/old.png",
      id: "old-object",
    });
    expect(mocks.scheduleCleanup).toHaveBeenCalledWith(expect.anything(), {
      assetId: "asset-1",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
      provider: "s3",
      providerObjectId: "old-object",
      url: "https://storage.example.test/old.png",
    });
  });

  it("does not retarget to a replacement row deleted after the initial read", async () => {
    mocks.removeReplacementBeforeTransaction = true;

    await expect(
      action.run({ id: "asset-1", replacementId: "asset-2" } as never),
    ).rejects.toMatchObject({
      errorCode: "asset_replace_failed",
      statusCode: 500,
    });

    expect(mocks.assets).toHaveLength(1);
    expect(mocks.assets[0]).toMatchObject({
      id: "asset-1",
      url: "https://storage.example.test/old.png",
      providerObjectId: "old-object",
    });
    expect(mocks.deleteFile).not.toHaveBeenCalled();
    expect(mocks.events).toEqual([
      "asset-read",
      "deck-reference-read",
      "concurrent-replacement-delete",
      "asset-update",
      "asset-row-delete",
    ]);
  });

  it("blocks replacement when an inaccessible private deck in the same org uses the donor", async () => {
    mocks.decks = [
      {
        id: "deck-1",
        data: JSON.stringify({ sourceTsx: '<img src="asset://asset-2" />' }),
        ownerEmail: "another-member@example.com",
        orgId: "org-1",
        visibility: "private",
      },
    ];

    await expect(
      action.run({ id: "asset-1", replacementId: "asset-2" } as never),
    ).rejects.toMatchObject({
      errorCode: "asset_replacement_in_use",
      statusCode: 409,
    });

    expect(mocks.assets).toHaveLength(2);
    expect(mocks.assets[1]!.url).toBe("https://storage.example.test/new.png");
    expect(mocks.events).toEqual(["asset-read", "deck-reference-read"]);
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });

  it("ignores a matching reference in a different org", async () => {
    mocks.decks = [
      {
        id: "deck-other-org",
        data: JSON.stringify({ sourceTsx: '<img src="asset://asset-2" />' }),
        ownerEmail: "another-member@example.com",
        orgId: "org-2",
        visibility: "private",
      },
    ];

    await expect(
      action.run({ id: "asset-1", replacementId: "asset-2" } as never),
    ).resolves.toMatchObject({ success: true, cleanupWarning: false });

    expect(mocks.assets).toHaveLength(1);
    expect(mocks.events).toEqual([
      "asset-read",
      "deck-reference-read",
      "asset-update",
      "asset-row-delete",
      "cleanup-marker-delete",
      "cleanup-scheduled",
      "blob-delete",
      "cleanup-finished",
    ]);
  });

  it("rejects self-replacement before reading or mutating assets", async () => {
    await expect(
      action.run({ id: "asset-1", replacementId: "asset-1" } as never),
    ).rejects.toMatchObject({
      errorCode: "asset_replacement_invalid",
      statusCode: 400,
    });

    expect(mocks.events).toEqual([]);
    expect(mocks.assets).toHaveLength(2);
  });

  it("reports a failed old-file cleanup without claiming cleanup succeeded", async () => {
    mocks.deleteFile.mockResolvedValue(false);

    await expect(
      action.run({ id: "asset-1", replacementId: "asset-2" } as never),
    ).resolves.toMatchObject({ success: true, cleanupWarning: true });

    expect(mocks.scheduleCleanup).toHaveBeenCalledWith(expect.anything(), {
      assetId: "asset-1",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
      provider: "s3",
      providerObjectId: "old-object",
      url: "https://storage.example.test/old.png",
    });
    expect(mocks.retryCleanup).toHaveBeenCalledWith(
      {
        assetId: "asset-1",
        ownerEmail: "owner@example.com",
        orgId: "org-1",
      },
      "cleanup-token",
      1,
    );
    expect(mocks.finishCleanup).not.toHaveBeenCalled();
    expect(mocks.events).toContain("cleanup-retried");
  });

  it("keeps a shared stored file when replacing a duplicate asset record", async () => {
    mocks.assets[1]!.providerObjectId = mocks.assets[0]!.providerObjectId;

    await expect(
      action.run({ id: "asset-1", replacementId: "asset-2" } as never),
    ).resolves.toMatchObject({ success: true, cleanupWarning: false });

    expect(mocks.deleteFile).not.toHaveBeenCalled();
    expect(mocks.events).toEqual([
      "asset-read",
      "deck-reference-read",
      "asset-update",
      "asset-row-delete",
      "cleanup-marker-delete",
      "cleanup-marker-delete",
    ]);
  });

  it("does not update another owner's asset", async () => {
    mocks.assets[0]!.ownerEmail = "other@example.com";

    await expect(
      action.run({ id: "asset-1", filename: "brand.png" } as never),
    ).rejects.toMatchObject({ errorCode: "asset_not_found", statusCode: 404 });

    expect(mocks.assets[0]!.filename).toBe("old.png");
  });

  it("updates the owner's legacy asset without an org ID", async () => {
    mocks.assets[0]!.orgId = null;

    await expect(
      action.run({ id: "asset-1", filename: "brand.png" } as never),
    ).resolves.toEqual({ success: true, filename: "brand.png" });

    expect(mocks.assets[0]!.filename).toBe("brand.png");
  });

  it("does not update an asset from another workspace", async () => {
    mocks.assets[0]!.orgId = "other-org";

    await expect(
      action.run({ id: "asset-1", filename: "brand.png" } as never),
    ).rejects.toMatchObject({ errorCode: "asset_not_found", statusCode: 404 });

    expect(mocks.assets[0]!.filename).toBe("old.png");
  });
});
