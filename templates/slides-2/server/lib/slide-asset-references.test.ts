import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  schema: {
    uploadedAssets: {
      id: "uploaded-assets.id",
      ownerEmail: "ownerEmail",
      orgId: "orgId",
    },
    uploadedAssetCleanupOutbox: {
      id: "cleanup.id",
      ownerEmail: "cleanup.ownerEmail",
      orgId: "cleanup.orgId",
    },
    decks: {
      id: "decks.id",
      data: "data",
      ownerEmail: "ownerEmail",
      orgId: "orgId",
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  asc: (column: unknown) => ({ kind: "asc", column }),
  eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
  gt: (column: unknown, value: unknown) => ({ kind: "gt", column, value }),
  inArray: (column: unknown, values: unknown[]) => ({
    kind: "inArray",
    column,
    values,
  }),
  isNull: (column: unknown) => ({ kind: "isNull", column }),
  or: (...conditions: unknown[]) => ({ kind: "or", conditions }),
}));

vi.mock("../db/index.js", () => ({
  getDb: vi.fn(),
  schema: mocks.schema,
}));

import {
  collectDeckSlideAssetIds,
  findDeckReferencesToAssets,
  withSlideAssetReferencesLocked,
} from "./slide-asset-references.js";

function deckWithSource(sourceTsx: string) {
  return {
    appId: "slides-2",
    slides: [{ id: "slide-1", sourceTsx }],
  };
}

function makeLockingTransaction(
  lock: (mode: string) => Promise<Array<{ id: string }>>,
  pendingCleanup: Array<{ id: string }> = [],
) {
  const forLock = vi.fn(lock);
  const where = vi.fn();
  const tx = {
    select: vi.fn(() => {
      let table: unknown;
      const builder = {
        from: vi.fn((selectedTable: unknown) => {
          table = selectedTable;
          return builder;
        }),
        where: vi.fn((condition: unknown) => {
          where(condition);
          return builder;
        }),
        orderBy: vi.fn(() => builder),
        for: forLock,
        then: (
          resolve: (value: Array<{ id: string }>) => unknown,
          reject: (error: unknown) => unknown,
        ) =>
          Promise.resolve(
            table === mocks.schema.uploadedAssetCleanupOutbox
              ? pendingCleanup
              : [],
          ).then(resolve, reject),
      };
      return builder;
    }),
  };
  return { tx, forLock, where };
}

function makeDeckReferenceTransaction(
  rows: Array<{
    id: string;
    data: unknown;
    ownerEmail: string;
    orgId: string | null;
  }>,
) {
  const select = vi.fn();
  const findCursor = (condition: unknown): string | undefined => {
    if (!condition || typeof condition !== "object") return undefined;
    const value = condition as {
      kind?: string;
      column?: unknown;
      value?: unknown;
      conditions?: unknown[];
    };
    if (
      value.kind === "gt" &&
      value.column === mocks.schema.decks.id &&
      typeof value.value === "string"
    ) {
      return value.value;
    }
    for (const child of value.conditions ?? []) {
      const cursor = findCursor(child);
      if (cursor) return cursor;
    }
    return undefined;
  };
  const tx = {
    select: select.mockImplementation(() => {
      let table: unknown;
      let condition: unknown;
      let pageSize = rows.length;
      const builder = {
        from: vi.fn((selectedTable: unknown) => {
          table = selectedTable;
          return builder;
        }),
        where: vi.fn((nextCondition: unknown) => {
          condition = nextCondition;
          return builder;
        }),
        orderBy: vi.fn(() => builder),
        limit: vi.fn((nextPageSize: number) => {
          pageSize = nextPageSize;
          return builder;
        }),
        then: (
          resolve: (value: typeof rows) => unknown,
          reject: (error: unknown) => unknown,
        ) => {
          const cursor = findCursor(condition);
          const page =
            table === mocks.schema.decks
              ? rows
                  .filter((row) => !cursor || row.id > cursor)
                  .sort((left, right) => left.id.localeCompare(right.id))
                  .slice(0, pageSize)
              : [];
          return Promise.resolve(page).then(resolve, reject);
        },
      };
      return builder;
    }),
  };
  return { tx, select };
}

describe("slide asset references", () => {
  it("collects canonical IDs from escaped TSX handles", () => {
    const sourceTsx = String.raw`<img src={"asset:\u002f\u002fasset-1"} />`;

    expect(collectDeckSlideAssetIds(deckWithSource(sourceTsx))).toEqual([
      "asset-1",
    ]);
  });

  it("collects handles from legacy content when no source is stored", () => {
    expect(
      collectDeckSlideAssetIds({
        appId: "slides-2",
        slides: [
          {
            id: "legacy-slide",
            content:
              '<img src="asset://legacy-image" style="background-image: url(asset://legacy-background)" />',
          },
        ],
      }),
    ).toEqual(["legacy-background", "legacy-image"]);
  });

  it("collects references from saved image and background fields", () => {
    expect(
      collectDeckSlideAssetIds({
        appId: "slides-2",
        slides: [
          {
            id: "field-slide",
            imageUrl: "asset://image-field",
            background: `linear-gradient(#000, #fff), url("asset://background-field")`,
          },
          { id: "direct-background-slide", background: "asset://direct-field" },
        ],
      }),
    ).toEqual(["background-field", "direct-field", "image-field"]);
  });

  it("waits for sorted asset share locks and rechecks every reference", async () => {
    let assetsLocked = false;
    const { tx, forLock, where } = makeLockingTransaction(async (mode) => {
      expect(mode).toBe("share");
      await Promise.resolve();
      assetsLocked = true;
      return [{ id: "asset-a" }, { id: "asset-z" }];
    });
    const db = {
      transaction: (run: (transaction: unknown) => Promise<unknown>) => run(tx),
    };
    let writeRan = false;

    await withSlideAssetReferencesLocked(
      db as never,
      deckWithSource(
        String.raw`<><img src={"asset:\u002f\u002fasset-z"} /><img src="asset://asset-a" /></>`,
      ),
      { ownerEmail: "owner@example.com", orgId: "org-1" },
      async () => {
        writeRan = true;
        expect(assetsLocked).toBe(true);
      },
    );

    expect(writeRan).toBe(true);
    expect(forLock).toHaveBeenCalledWith("share");
    expect(where.mock.calls[0]?.[0]).toMatchObject({
      conditions: [
        {
          kind: "inArray",
          column: "uploaded-assets.id",
          values: ["asset-a", "asset-z"],
        },
        {
          kind: "or",
          conditions: [
            {
              kind: "and",
              conditions: [
                {
                  kind: "eq",
                  column: "ownerEmail",
                  value: "owner@example.com",
                },
                { kind: "eq", column: "orgId", value: "org-1" },
              ],
            },
            { kind: "eq", column: "orgId", value: "org-1" },
          ],
        },
      ],
    });
  });

  it("locks the deck row before referenced asset rows", async () => {
    const lockOrder: string[] = [];
    const tx = {
      select: vi.fn(() => {
        let table: unknown;
        const builder = {
          from: vi.fn((selectedTable: unknown) => {
            table = selectedTable;
            return builder;
          }),
          where: vi.fn(() => builder),
          orderBy: vi.fn(() => builder),
          for: vi.fn(async (mode: string) => {
            lockOrder.push(
              `${table === mocks.schema.decks ? "deck" : "asset"}:${mode}`,
            );
            return table === mocks.schema.uploadedAssets
              ? [{ id: "asset-a" }]
              : [];
          }),
          then: (
            resolve: (value: Array<{ id: string }>) => unknown,
            reject: (error: unknown) => unknown,
          ) => Promise.resolve([]).then(resolve, reject),
        };
        return builder;
      }),
    };
    const db = {
      transaction: (run: (transaction: unknown) => Promise<unknown>) => run(tx),
    };
    const write = vi.fn(async () => undefined);

    await withSlideAssetReferencesLocked(
      db as never,
      deckWithSource('<img src="asset://asset-a" />'),
      { ownerEmail: "owner@example.com", orgId: "org-1" },
      write,
      "deck-1",
    );

    expect(lockOrder).toEqual(["deck:update", "asset:share"]);
    expect(write).toHaveBeenCalledOnce();
  });

  it("takes the deck lock even when the existing deck has no asset references", async () => {
    const lockOrder: string[] = [];
    const tx = {
      select: vi.fn(() => {
        let table: unknown;
        const builder = {
          from: vi.fn((selectedTable: unknown) => {
            table = selectedTable;
            return builder;
          }),
          where: vi.fn(() => builder),
          orderBy: vi.fn(() => builder),
          for: vi.fn(async (mode: string) => {
            lockOrder.push(
              `${table === mocks.schema.decks ? "deck" : "asset"}:${mode}`,
            );
            return [];
          }),
          then: (
            resolve: (value: Array<{ id: string }>) => unknown,
            reject: (error: unknown) => unknown,
          ) => Promise.resolve([]).then(resolve, reject),
        };
        return builder;
      }),
    };
    const db = {
      transaction: (run: (transaction: unknown) => Promise<unknown>) => run(tx),
    };

    await withSlideAssetReferencesLocked(
      db as never,
      { appId: "slides-2", slides: [] },
      { ownerEmail: "owner@example.com", orgId: "org-1" },
      async () => undefined,
      "deck-1",
    );

    expect(lockOrder).toEqual(["deck:update"]);
  });

  it("rejects a missing asset after the locking query completes", async () => {
    const { tx } = makeLockingTransaction(async () => []);
    const db = {
      transaction: (run: (transaction: unknown) => Promise<unknown>) => run(tx),
    };
    const write = vi.fn();

    await expect(
      withSlideAssetReferencesLocked(
        db as never,
        deckWithSource('<img src="asset://missing" />'),
        { ownerEmail: "owner@example.com", orgId: "org-1" },
        write,
      ),
    ).rejects.toMatchObject({
      errorCode: "slide_asset_unavailable",
      statusCode: 404,
    });
    expect(write).not.toHaveBeenCalled();
  });

  it("rejects an asset that already has queued provider cleanup", async () => {
    const { tx } = makeLockingTransaction(
      async () => [{ id: "asset-a" }],
      [{ id: "asset-a" }],
    );
    const db = {
      transaction: (run: (transaction: unknown) => Promise<unknown>) => run(tx),
    };
    const write = vi.fn();

    await expect(
      withSlideAssetReferencesLocked(
        db as never,
        deckWithSource('<img src="asset://asset-a" />'),
        { ownerEmail: "owner@example.com", orgId: "org-1" },
        write,
      ),
    ).rejects.toMatchObject({
      errorCode: "slide_asset_unavailable",
      statusCode: 404,
    });
    expect(write).not.toHaveBeenCalled();
  });

  it("matches references within the asset's owner and organization scope", async () => {
    const { tx } = makeDeckReferenceTransaction([
      {
        id: "org-deck",
        ownerEmail: "other@example.com",
        orgId: "org-1",
        data: deckWithSource('<img src="asset://org-asset" />'),
      },
      {
        id: "wrong-org-deck",
        ownerEmail: "owner@example.com",
        orgId: "org-2",
        data: deckWithSource('<img src="asset://org-asset" />'),
      },
      {
        id: "owner-deck",
        ownerEmail: "owner@example.com",
        orgId: null,
        data: deckWithSource('<img src="asset://owner-asset" />'),
      },
      {
        id: "other-owner-deck",
        ownerEmail: "other@example.com",
        orgId: null,
        data: deckWithSource('<img src="asset://owner-asset" />'),
      },
      {
        id: "owner-org-deck",
        ownerEmail: "owner@example.com",
        orgId: "org-2",
        data: deckWithSource('<img src="asset://owner-asset" />'),
      },
      {
        id: "other-app-deck",
        ownerEmail: "owner@example.com",
        orgId: null,
        data: { appId: "other-app", slides: "malformed" },
      },
    ]);

    await expect(
      findDeckReferencesToAssets(
        tx as never,
        [
          { id: "org-asset", ownerEmail: "owner@example.com", orgId: "org-1" },
          { id: "owner-asset", ownerEmail: "owner@example.com", orgId: null },
        ],
        "ignored-deck",
      ),
    ).resolves.toEqual(
      new Map([
        ["org-asset", "org-deck"],
        ["owner-asset", "owner-deck"],
      ]),
    );
  });

  it("does not treat an owner's personal asset in an organization deck as accessible", async () => {
    const { tx } = makeDeckReferenceTransaction([
      {
        id: "owner-org-deck",
        ownerEmail: "owner@example.com",
        orgId: "org-1",
        data: deckWithSource('<img src="asset://owner-asset" />'),
      },
    ]);

    await expect(
      findDeckReferencesToAssets(tx as never, [
        { id: "owner-asset", ownerEmail: "owner@example.com", orgId: null },
      ]),
    ).resolves.toEqual(new Map());
  });

  it("matches an organization asset only in decks from that organization", async () => {
    const { tx } = makeDeckReferenceTransaction([
      {
        id: "same-org-deck",
        ownerEmail: "other@example.com",
        orgId: "org-1",
        data: deckWithSource('<img src="asset://org-asset" />'),
      },
      {
        id: "different-org-deck",
        ownerEmail: "owner@example.com",
        orgId: "org-2",
        data: deckWithSource('<img src="asset://org-asset" />'),
      },
    ]);

    await expect(
      findDeckReferencesToAssets(tx as never, [
        { id: "org-asset", ownerEmail: "owner@example.com", orgId: "org-1" },
      ]),
    ).resolves.toEqual(new Map([["org-asset", "same-org-deck"]]));
  });

  it("preserves scoped assets when a Slides deck has malformed source data", async () => {
    const { tx } = makeDeckReferenceTransaction([
      {
        id: "malformed-slides-deck",
        ownerEmail: "owner@example.com",
        orgId: null,
        data: { appId: "slides-2", slides: "malformed" },
      },
    ]);

    await expect(
      findDeckReferencesToAssets(tx as never, [
        { id: "owner-asset", ownerEmail: "owner@example.com", orgId: null },
      ]),
    ).resolves.toEqual(new Map([["owner-asset", "malformed-slides-deck"]]));
  });

  it("protects a personal asset when its owner's personal deck JSON is unparsable", async () => {
    const { tx } = makeDeckReferenceTransaction([
      {
        id: "unparsable-slides-deck",
        ownerEmail: "owner@example.com",
        orgId: null,
        data: '{"appId":"slides-2","slides":',
      },
    ]);

    await expect(
      findDeckReferencesToAssets(tx as never, [
        { id: "owner-asset", ownerEmail: "owner@example.com", orgId: null },
      ]),
    ).resolves.toEqual(new Map([["owner-asset", "unparsable-slides-deck"]]));
  });

  it("does not protect a personal asset for an unparsable organization deck", async () => {
    const { tx } = makeDeckReferenceTransaction([
      {
        id: "unparsable-org-deck",
        ownerEmail: "owner@example.com",
        orgId: "org-1",
        data: '{"appId":"slides-2","slides":',
      },
    ]);

    await expect(
      findDeckReferencesToAssets(tx as never, [
        { id: "owner-asset", ownerEmail: "owner@example.com", orgId: null },
      ]),
    ).resolves.toEqual(new Map());
  });

  it("protects an organization asset for an unparsable deck in that organization", async () => {
    const { tx } = makeDeckReferenceTransaction([
      {
        id: "unparsable-org-deck",
        ownerEmail: "other@example.com",
        orgId: "org-1",
        data: '{"appId":"slides-2","slides":',
      },
    ]);

    await expect(
      findDeckReferencesToAssets(tx as never, [
        { id: "org-asset", ownerEmail: "owner@example.com", orgId: "org-1" },
      ]),
    ).resolves.toEqual(new Map([["org-asset", "unparsable-org-deck"]]));
  });

  it("scans deck references in bounded keyset pages and stops after a match", async () => {
    const rows = Array.from({ length: 205 }, (_, index) => ({
      id: `deck-${String(index).padStart(3, "0")}`,
      data: deckWithSource(
        index === 120 ? '<img src="asset://target-asset" />' : "<div />",
      ),
      ownerEmail: "owner@example.com",
      orgId: null,
    }));
    const { tx, select } = makeDeckReferenceTransaction(rows);

    await expect(
      findDeckReferencesToAssets(tx as never, [
        { id: "target-asset", ownerEmail: "owner@example.com", orgId: null },
      ]),
    ).resolves.toEqual(new Map([["target-asset", "deck-120"]]));

    expect(select).toHaveBeenCalledTimes(2);
    for (const query of select.mock.results) {
      expect(query.value.limit).toHaveBeenCalledWith(100);
    }
  });

  it("does not read later pages after all requested assets are found", async () => {
    const rows = Array.from({ length: 205 }, (_, index) => ({
      id: `deck-${String(index).padStart(3, "0")}`,
      data: deckWithSource(
        index === 0 ? '<img src="asset://target-asset" />' : "<div />",
      ),
      ownerEmail: "owner@example.com",
      orgId: null,
    }));
    const { tx, select } = makeDeckReferenceTransaction(rows);

    await expect(
      findDeckReferencesToAssets(tx as never, [
        { id: "target-asset", ownerEmail: "owner@example.com", orgId: null },
      ]),
    ).resolves.toEqual(new Map([["target-asset", "deck-000"]]));

    expect(select).toHaveBeenCalledTimes(1);
  });
});
