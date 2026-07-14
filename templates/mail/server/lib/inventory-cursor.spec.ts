import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => {
  const updateReturns: any[][] = [];
  const deleteReturns: any[][] = [];
  const updateWhere = vi.fn(() => ({
    returning: vi.fn(async () => updateReturns.shift() ?? []),
  }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const updateFn = vi.fn(() => ({ set: updateSet }));
  const deleteReturning = vi.fn(async () => deleteReturns.shift() ?? []);
  const deleteWhere = vi.fn(() => ({ returning: deleteReturning }));
  const deleteFn = vi.fn(() => ({ where: deleteWhere }));
  const insertValues = vi.fn(async () => undefined);
  const insertFn = vi.fn(() => ({ values: insertValues }));
  const db = {
    update: updateFn,
    delete: deleteFn,
    insert: insertFn,
    transaction: vi.fn(async (fn: (tx: any) => unknown) => fn(db)),
  };
  return {
    updateReturns,
    deleteReturns,
    updateWhere,
    updateSet,
    updateFn,
    deleteReturning,
    deleteWhere,
    deleteFn,
    insertValues,
    insertFn,
    db,
    getDb: vi.fn(() => db),
  };
});

vi.mock("../db/index.js", () => ({ getDb: dbMock.getDb }));

import {
  buildMailInventoryPage,
  claimInventoryCursor,
  inventoryQueryFingerprint,
  releaseInventoryCursorClaim,
  settleInventoryCursorClaim,
  type MailInventoryCursorState,
  type MailInventoryItem,
} from "./inventory-cursor.js";

function item(
  id: string,
  accountEmail: string,
  date: string,
): MailInventoryItem {
  return {
    id,
    threadId: `${id}-thread`,
    accountEmail,
    date,
    from: { email: "sender@example.com" },
    subject: id,
    isUnread: true,
    messageCount: 1,
    unreadCount: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.updateReturns.length = 0;
  dbMock.deleteReturns.length = 0;
});

describe("mail inventory merge", () => {
  it("globally orders busy and quiet accounts and exhausts every row exactly once", async () => {
    const busy = "busy@example.com";
    const quiet = "quiet@example.com";
    const state: MailInventoryCursorState = {
      queryFingerprint: "query",
      requestedAccounts: null,
      firstPage: true,
      accounts: [busy, quiet].map((accountEmail) => ({
        accountEmail,
        status: "ok" as const,
        exhausted: false,
        pending: [],
        emittedCount: 0,
      })),
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        items: [
          item("busy-3", busy, "2026-07-13T13:00:00Z"),
          item("busy-2", busy, "2026-07-13T12:00:00Z"),
          item("quiet-1", quiet, "2026-07-13T10:00:00Z"),
        ],
        errors: {},
        nextPageTokens: { [busy]: "busy-next" },
      })
      .mockResolvedValueOnce({
        items: [item("busy-1", busy, "2026-07-13T11:00:00Z")],
        errors: {},
        nextPageTokens: {},
      });

    const first = await buildMailInventoryPage(state, 2, fetch);
    const second = await buildMailInventoryPage(state, 2, fetch);
    const ids = [...first.items, ...second.items].map((row) => row.id);

    expect(first.items.map((row) => row.id)).toEqual(["busy-3", "busy-2"]);
    expect(first.hasMore).toBe(true);
    expect(second.hasMore).toBe(false);
    expect(ids).toHaveLength(new Set(ids).size);
    expect(ids.sort()).toEqual(["busy-1", "busy-2", "busy-3", "quiet-1"]);
    expect(fetch).toHaveBeenNthCalledWith(2, [
      { accountEmail: busy, pageToken: "busy-next" },
    ]);
    expect(state.accounts).toEqual([
      expect.objectContaining({
        accountEmail: busy,
        exhausted: true,
        emittedCount: 3,
      }),
      expect.objectContaining({
        accountEmail: quiet,
        exhausted: true,
        emittedCount: 1,
      }),
    ]);
  });

  it("refills every empty frontier before choosing the next global row", async () => {
    const accounts = [
      "a@example.com",
      "b@example.com",
      "c@example.com",
      "d@example.com",
    ];
    const state: MailInventoryCursorState = {
      queryFingerprint: "query",
      requestedAccounts: null,
      firstPage: true,
      accounts: accounts.map((accountEmail) => ({
        accountEmail,
        status: "ok",
        exhausted: false,
        pending: [],
        emittedCount: 0,
        emittedThreadIds: [],
      })),
    };
    const pages: Record<string, MailInventoryItem[][]> = {
      [accounts[0]]: [
        [item("a4", accounts[0], "2026-07-13T14:00:00Z")],
        [item("a2", accounts[0], "2026-07-13T12:00:00Z")],
      ],
      [accounts[1]]: [[item("b3", accounts[1], "2026-07-13T13:00:00Z")]],
      [accounts[2]]: [[]],
      [accounts[3]]: [[item("d1", accounts[3], "2026-07-13T11:00:00Z")]],
    };
    const positions = new Map<string, number>();
    const fetch = vi.fn(async (requests: Array<{ accountEmail: string }>) => {
      const rows: MailInventoryItem[] = [];
      const nextPageTokens: Record<string, string> = {};
      for (const request of requests) {
        const position = positions.get(request.accountEmail) ?? 0;
        rows.push(...(pages[request.accountEmail]?.[position] ?? []));
        positions.set(request.accountEmail, position + 1);
        if (position + 1 < (pages[request.accountEmail]?.length ?? 0)) {
          nextPageTokens[request.accountEmail] = `page-${position + 1}`;
        }
      }
      return { items: rows, errors: {}, nextPageTokens };
    });

    const emitted: MailInventoryItem[] = [];
    while (true) {
      const page = await buildMailInventoryPage(state, 1, fetch);
      emitted.push(...page.items);
      if (!page.hasMore) break;
    }

    expect(emitted.map((row) => row.id)).toEqual(["a4", "b3", "a2", "d1"]);
    expect(
      new Set(emitted.map((row) => `${row.accountEmail}:${row.threadId}`)).size,
    ).toBe(4);
    expect(state.accounts.map((account) => account.knownCount ?? 0)).toEqual([
      2, 1, 0, 1,
    ]);
  });

  it("binds a fingerprint to nested query values independent of key order", () => {
    const fingerprint = inventoryQueryFingerprint({
      query: { view: "inbox", q: null },
      accounts: ["a@example.com"],
    });
    expect(fingerprint).toHaveLength(64);
    expect(fingerprint).toBe(
      inventoryQueryFingerprint({
        accounts: ["a@example.com"],
        query: { q: null, view: "inbox" },
      }),
    );
  });

  it("reports an unknown frontier after four empty provider pages", async () => {
    const accountEmail = "empty-pages@example.com";
    const state: MailInventoryCursorState = {
      queryFingerprint: "query",
      requestedAccounts: null,
      firstPage: true,
      accounts: [
        {
          accountEmail,
          status: "ok",
          exhausted: false,
          pending: [],
          emittedCount: 0,
        },
      ],
    };
    let page = 0;
    const fetch = vi.fn(async () => ({
      items: [],
      errors: {},
      nextPageTokens: { [accountEmail]: `next-${++page}` },
    }));

    const result = await buildMailInventoryPage(state, 10, fetch);

    expect(result).toEqual({ items: [], hasMore: false });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(state.accounts[0]).toEqual(
      expect.objectContaining({
        status: "error",
        exhausted: true,
        error: expect.objectContaining({
          code: "pagination_limit",
          retryable: true,
        }),
      }),
    );
  });

  it("does not re-emit a thread repeated by a later provider page", async () => {
    const accountEmail = "busy@example.com";
    const repeated = item("repeated", accountEmail, "2026-07-13T13:00:00Z");
    const state: MailInventoryCursorState = {
      queryFingerprint: "query",
      requestedAccounts: null,
      firstPage: true,
      accounts: [
        {
          accountEmail,
          status: "ok",
          exhausted: false,
          pending: [],
          emittedCount: 0,
          emittedThreadIds: [],
        },
      ],
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        items: [repeated],
        errors: {},
        nextPageTokens: { [accountEmail]: "next" },
      })
      .mockResolvedValueOnce({
        items: [repeated, item("new", accountEmail, "2026-07-13T12:00:00Z")],
        errors: {},
        nextPageTokens: {},
      });

    const first = await buildMailInventoryPage(state, 1, fetch);
    const second = await buildMailInventoryPage(state, 2, fetch);

    expect([...first.items, ...second.items].map((row) => row.id)).toEqual([
      "repeated",
      "new",
    ]);
    expect(state.accounts[0]?.emittedCount).toBe(2);
  });
});

describe("mail inventory cursor claim", () => {
  it("allows only one concurrent owner/query/expiry-bound lease", async () => {
    const state: MailInventoryCursorState = {
      queryFingerprint: "query",
      requestedAccounts: null,
      firstPage: false,
      accounts: [],
    };
    dbMock.updateReturns.push(
      [
        {
          state: JSON.stringify(state),
          expiresAt: Date.now() + 60_000,
          version: 3,
        },
      ],
      [],
    );

    const claims = await Promise.all([
      claimInventoryCursor("owner@example.com", "cursor", "query"),
      claimInventoryCursor("owner@example.com", "cursor", "query"),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.filter((claim) => claim === null)).toHaveLength(1);
    expect(dbMock.updateFn).toHaveBeenCalledTimes(2);
    expect(claims[0]).toEqual(
      expect.objectContaining({
        ownerEmail: "owner@example.com",
        queryFingerprint: "query",
        version: 3,
        state,
      }),
    );
  });

  it("rejects an expired lease candidate", async () => {
    dbMock.updateReturns.push([
      { state: "{}", expiresAt: Date.now() - 1, version: 1 },
    ]);
    await expect(
      claimInventoryCursor("owner@example.com", "cursor", "query"),
    ).resolves.toBeNull();
  });

  it("releases a transient failure with the exact lease witness", async () => {
    const claim = {
      id: "cursor",
      claimId: "claim",
      ownerEmail: "owner@example.com",
      queryFingerprint: "query",
      version: 2,
      state: {
        queryFingerprint: "query",
        requestedAccounts: null,
        firstPage: false,
        accounts: [],
      },
    };
    await releaseInventoryCursorClaim(claim);
    expect(dbMock.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ claimId: null, claimedAt: null }),
    );
  });

  it("settles a consumed lease into a distinct successor", async () => {
    const state: MailInventoryCursorState = {
      queryFingerprint: "query",
      requestedAccounts: null,
      firstPage: false,
      accounts: [],
    };
    const claim = {
      id: "cursor",
      claimId: "claim",
      ownerEmail: "owner@example.com",
      queryFingerprint: "query",
      version: 4,
      state,
    };
    dbMock.deleteReturns.push([{ id: "cursor" }]);

    const successor = await settleInventoryCursorClaim(claim, state, true);

    expect(successor).toEqual(expect.any(String));
    expect(successor).not.toBe("cursor");
    expect(dbMock.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: successor,
        ownerEmail: "owner@example.com",
        queryFingerprint: "query",
        version: 5,
        claimId: null,
      }),
    );
  });
});
