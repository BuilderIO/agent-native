import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  runWithRequestContext: vi.fn(),
  select: vi.fn(),
  transaction: vi.fn(),
  selectForUpdate: vi.fn(),
  insertValues: vi.fn(),
  registerObjectIdentities: vi.fn(),
  transactionObject: null as unknown,
  transactionContext: { execute: vi.fn() },
  deck: null as {
    data: string;
    ownerEmail: string;
    orgId: string | null;
  } | null,
  events: [] as string[],
  schema: {
    decks: {
      id: "decks.id",
      data: "decks.data",
      ownerEmail: "decks.ownerEmail",
      orgId: "decks.orgId",
    },
    uploadedAssets: { id: "uploaded_assets.id" },
  },
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => undefined,
  runWithRequestContext: (...args: unknown[]) =>
    mocks.runWithRequestContext(...args),
}));

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => mocks.transactionContext,
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => ({
    select: (...args: unknown[]) => mocks.select(...args),
    transaction: (...args: unknown[]) => mocks.transaction(...args),
  }),
  schema: mocks.schema,
}));

vi.mock("./uploaded-asset-object-lifecycle.js", () => ({
  registerUploadedAssetObjectIdentities: (...args: unknown[]) =>
    mocks.registerObjectIdentities(...args),
}));

import {
  assertDeckAssetUploadScope,
  parseOptionalDeckId,
  registerDeckUploadedAsset,
} from "./deck-asset-scope";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deck = null;
  mocks.events.length = 0;
  mocks.transactionObject = null;
  mocks.transactionContext = { execute: vi.fn() };
  mocks.registerObjectIdentities.mockReset().mockImplementation(async () => {
    mocks.events.push("object-register");
  });
  mocks.runWithRequestContext.mockImplementation(
    async (_context: unknown, callback: () => unknown) => callback(),
  );
  mocks.assertAccess.mockImplementation(async (...args: unknown[]) => {
    mocks.events.push("access-check");
    expect(args.slice(0, 3)).toEqual(["deck", "deck-1", "editor"]);
  });
  mocks.selectForUpdate.mockImplementation(async (table: unknown) => {
    mocks.events.push("deck-lock-read");
    return table === mocks.schema.decks && mocks.deck ? [mocks.deck] : [];
  });
  mocks.insertValues.mockImplementation(async () => {
    mocks.events.push("asset-insert");
  });
  mocks.transaction.mockImplementation(
    async (callback: (tx: unknown) => unknown) => {
      const transaction = {
        select: () => ({
          from: (table: unknown) => ({
            where: () => ({
              for: () => mocks.selectForUpdate(table),
            }),
          }),
        }),
        insert: (table: unknown) => ({
          values: (row: unknown) => mocks.insertValues(table, row),
        }),
      };
      mocks.transactionObject = transaction;
      return callback(transaction);
    },
  );
  mocks.select.mockImplementation(() => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: async () => {
          mocks.events.push("deck-read");
          return table === mocks.schema.decks && mocks.deck ? [mocks.deck] : [];
        },
      }),
    }),
  }));
});

describe("deck asset upload scope", () => {
  it("does not query a deck for a global upload", async () => {
    await expect(
      assertDeckAssetUploadScope({ email: "owner@example.com" }),
    ).resolves.toBeUndefined();
    expect(mocks.assertAccess).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("requires editor access before reading a markerless legacy deck", async () => {
    mocks.deck = {
      data: JSON.stringify({ slides: [] }),
      ownerEmail: "owner@example.com",
      orgId: null,
    };

    await expect(
      assertDeckAssetUploadScope({
        deckId: "deck-1",
        email: "owner@example.com",
      }),
    ).rejects.toMatchObject({ statusCode: 404, errorCode: "deck_not_found" });

    expect(mocks.events).toEqual(["access-check", "deck-read"]);
    expect(mocks.runWithRequestContext).toHaveBeenCalledWith(
      { userEmail: "owner@example.com", orgId: undefined },
      expect.any(Function),
    );
  });

  it("rejects explicit foreign-app decks before any asset write can start", async () => {
    mocks.deck = {
      data: JSON.stringify({ appId: "slides", slides: [] }),
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    };

    await expect(
      assertDeckAssetUploadScope({
        deckId: "deck-1",
        email: "owner@example.com",
        orgId: "org-1",
      }),
    ).rejects.toMatchObject({ statusCode: 404, errorCode: "deck_not_found" });

    expect(mocks.events).toEqual(["access-check", "deck-read"]);
  });

  it("rejects an uploader whose org scope would make the asset invisible in this deck", async () => {
    mocks.deck = {
      data: JSON.stringify({ appId: "slides-2", slides: [] }),
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    };

    await expect(
      assertDeckAssetUploadScope({
        deckId: "deck-1",
        email: "owner@example.com",
        orgId: "org-2",
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: "asset_deck_scope_forbidden",
    });
  });

  it("rechecks editor access in the registration transaction after upload", async () => {
    mocks.deck = {
      data: JSON.stringify({ appId: "slides-2", slides: [] }),
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    };

    await assertDeckAssetUploadScope({
      deckId: "deck-1",
      email: "editor@example.com",
      orgId: "org-1",
    });
    mocks.assertAccess.mockRejectedValueOnce(new Error("editor share revoked"));

    await expect(
      registerDeckUploadedAsset({
        deckId: "deck-1",
        email: "editor@example.com",
        orgId: "org-1",
        row: {
          id: "asset-1",
          filename: "image.png",
          url: "https://cdn.example.com/image.png",
          type: "image/png",
          size: 1,
          ownerEmail: "editor@example.com",
          orgId: "org-1",
          deckId: "deck-1",
          createdAt: new Date().toISOString(),
        },
      }),
    ).rejects.toThrow("editor share revoked");

    expect(mocks.assertAccess).toHaveBeenCalledTimes(2);
    expect(mocks.assertAccess).toHaveBeenLastCalledWith(
      "deck",
      "deck-1",
      "editor",
      expect.objectContaining({
        userEmail: "editor@example.com",
        orgId: "org-1",
        transaction: mocks.transactionContext,
      }),
    );
    expect(mocks.assertAccess.mock.invocationCallOrder[1]).toBeGreaterThan(
      mocks.selectForUpdate.mock.invocationCallOrder[0],
    );
    expect(mocks.insertValues).not.toHaveBeenCalled();
    expect(mocks.events).not.toContain("asset-insert");
  });

  it("registers an object identity in the asset insert transaction", async () => {
    mocks.deck = {
      data: JSON.stringify({ appId: "slides-2", slides: [] }),
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    };

    await registerDeckUploadedAsset({
      deckId: "deck-1",
      email: "owner@example.com",
      orgId: "org-1",
      row: {
        id: "asset-1",
        filename: "image.png",
        url: "https://cdn.example.com/image.png",
        type: "image/png",
        size: 1,
        ownerEmail: "owner@example.com",
        orgId: "org-1",
        deckId: "deck-1",
        createdAt: new Date().toISOString(),
      },
    });

    expect(mocks.registerObjectIdentities).toHaveBeenCalledWith(
      mocks.transactionObject,
      [
        {
          url: "https://cdn.example.com/image.png",
          provider: null,
          providerObjectId: null,
        },
      ],
    );
    expect(mocks.events).toEqual([
      "deck-lock-read",
      "access-check",
      "object-register",
      "asset-insert",
    ]);
  });

  it("parses one bounded optional deckId field and rejects duplicates or malformed fields", () => {
    expect(
      parseOptionalDeckId([
        { name: "deckId", data: new TextEncoder().encode(" deck-1 ") },
      ]),
    ).toBe("deck-1");
    expect(
      parseOptionalDeckId([{ name: "file", data: new Uint8Array([1]) }]),
    ).toBe(undefined);
    expect(() =>
      parseOptionalDeckId([
        { name: "deckId", data: new TextEncoder().encode("deck-1") },
        { name: "deckId", data: new TextEncoder().encode("deck-2") },
      ]),
    ).toThrow("Invalid deckId field.");
    expect(() =>
      parseOptionalDeckId([{ name: "deckId", data: new Uint8Array(201) }]),
    ).toThrow("Invalid deckId field.");
  });
});
