import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  type InboxOverview,
  applyInboxMutationOverlay,
  adjustInboxThreadUnreadOptimistic,
  cancelInboxThreadsQueries,
  clearInboxThreadRemoval,
  findInboxThreadIdByMessageId,
  INBOX_THREADS_QUERY_KEY,
  inboxOverviewQueryKey,
  inboxThreadsHasNextPage,
  keepLatestInboxSnapshot,
  inboxThreadsRefetchInterval,
  isUnauthorizedError,
  mergeOptimisticInboxTabCounts,
  markInboxThreadReadOptimistic,
  mergeInboxThreadPages,
  publishInboxOverview,
  removeInboxThreadsOptimistic,
  retainInboxMutationTargets,
  resolveInboxTabId,
  restoreInboxThreadRemovals,
  restoreInboxThreadsOptimistic,
  settleInboxMutationIfObserved,
  snapshotInboxThreads,
  toggleInboxThreadsStarOptimistic,
} from "./use-inbox-threads";

describe("isUnauthorizedError", () => {
  it("is true for a 401 or 403 action error", () => {
    expect(isUnauthorizedError({ status: 401 })).toBe(true);
    expect(isUnauthorizedError({ status: 403 })).toBe(true);
  });

  it("is false for other statuses, and for no error", () => {
    expect(isUnauthorizedError({ status: 404 })).toBe(false);
    expect(isUnauthorizedError({ status: 500 })).toBe(false);
    expect(isUnauthorizedError(null)).toBe(false);
    expect(isUnauthorizedError(new Error("network down"))).toBe(false);
  });
});

describe("inboxThreadsRefetchInterval", () => {
  it("stops the poll once the last error is a 401 or 403", () => {
    expect(
      inboxThreadsRefetchInterval({ state: { error: { status: 401 } } }),
    ).toBe(false);
    expect(
      inboxThreadsRefetchInterval({ state: { error: { status: 403 } } }),
    ).toBe(false);
  });

  it("keeps polling at the fast interval for a non-auth error, e.g. a 500", () => {
    expect(
      inboxThreadsRefetchInterval({ state: { error: { status: 500 } } }),
    ).toBe(20_000);
  });

  it("polls fast while the account is syncing", () => {
    expect(
      inboxThreadsRefetchInterval({
        state: { error: null, data: { syncing: true } },
      }),
    ).toBe(3_000);
  });

  it("polls at the idle interval once sync settles", () => {
    expect(
      inboxThreadsRefetchInterval({
        state: { error: null, data: { syncing: false } },
      }),
    ).toBe(20_000);
  });
});

describe("shared inbox overview snapshots", () => {
  it("keeps the newest tab counts in one account-scoped cache across tab switches", () => {
    const qc = new QueryClient();
    const accounts = ["steve@example.com"];
    const queryKey = inboxOverviewQueryKey(accounts);
    const snapshot = (clientSnapshotId: number, totals: number[]) => ({
      tabs: ["important", "automated", "pitch"].map((id, index) => ({
        id,
        kind: "label" as const,
        name: id,
        total: totals[index]!,
        unread: 0,
      })),
      syncing: false,
      accounts: [],
      labels: [],
      clientSnapshotId,
    });

    publishInboxOverview(qc, accounts, snapshot(4, [2, 36, 2]));
    expect(
      qc.getQueryData<InboxOverview>(queryKey)?.tabs.map((tab) => tab.total),
    ).toEqual([2, 36, 2]);

    publishInboxOverview(qc, accounts, snapshot(3, [1, 35, 1]));
    expect(
      qc.getQueryData<InboxOverview>(queryKey)?.tabs.map((tab) => tab.total),
    ).toEqual([2, 36, 2]);

    publishInboxOverview(qc, accounts, snapshot(5, [3, 36, 2]));
    expect(
      qc.getQueryData<InboxOverview>(queryKey)?.tabs.map((tab) => tab.total),
    ).toEqual([3, 36, 2]);
    expect(
      inboxOverviewQueryKey(["STEVE@example.com", "other@example.com"]),
    ).toEqual(
      inboxOverviewQueryKey(["other@example.com", "steve@example.com"]),
    );
  });

  it("applies optimistic count deltas to the shared active-tab snapshot", () => {
    const tab = (id: string, total: number, unread: number) => ({
      id,
      kind: "label" as const,
      name: id,
      total,
      unread,
    });
    const overviewTabs = [tab("important", 4, 3), tab("automated", 36, 8)];
    const base = {
      activeTabId: "important",
      tabs: [tab("important", 2, 2), tab("automated", 36, 8)],
    };
    const projected = {
      activeTabId: "important",
      tabs: [tab("important", 1, 1), tab("automated", 36, 8)],
    };

    expect(
      mergeOptimisticInboxTabCounts(overviewTabs, base, projected),
    ).toEqual([tab("important", 3, 2), tab("automated", 36, 8)]);
    expect(
      mergeOptimisticInboxTabCounts(overviewTabs, base, {
        ...projected,
        activeTabId: "automated",
      }),
    ).toBe(overviewTabs);
  });
});

describe("resolveInboxTabId", () => {
  it("returns undefined with no params so the server defaults to its first tab", () => {
    expect(resolveInboxTabId(new URLSearchParams())).toBeUndefined();
  });

  it("passes a `tab` param straight through, including the `other` sentinel", () => {
    expect(resolveInboxTabId(new URLSearchParams("tab=important"))).toBe(
      "important",
    );
    expect(resolveInboxTabId(new URLSearchParams("tab=other"))).toBe("other");
    expect(resolveInboxTabId(new URLSearchParams("tab=__inbox_all__"))).toBe(
      "__inbox_all__",
    );
  });

  it("maps the legacy `label` param to a tab id", () => {
    expect(resolveInboxTabId(new URLSearchParams("label=work"))).toBe("work");
  });

  it("maps the legacy `filter` param to a tab id", () => {
    expect(resolveInboxTabId(new URLSearchParams("filter=urgent-filter"))).toBe(
      "urgent-filter",
    );
  });

  it("prefers `tab` over the legacy params when a link somehow carries both", () => {
    expect(
      resolveInboxTabId(new URLSearchParams("tab=important&label=work")),
    ).toBe("important");
  });
});

function seedResult(overrides?: {
  items?: Array<{
    id: string;
    threadId: string;
    unreadCount: number;
    isRead: boolean;
    isStarred: boolean;
    messageCount?: number;
  }>;
  activeTabId?: string;
  tabs?: Array<{ id: string; total: number; unread: number }>;
  complete?: boolean;
  clientSnapshotId?: number;
  total?: number;
}) {
  return {
    tabs: overrides?.tabs ?? [
      {
        id: "important",
        kind: "important",
        name: "Important",
        total: 3,
        unread: 2,
      },
      { id: "other", kind: "other", name: "Other", total: 1, unread: 1 },
    ],
    activeTabId: overrides?.activeTabId ?? "important",
    items: overrides?.items ?? [
      {
        id: "m1",
        threadId: "t1",
        unreadCount: 1,
        isRead: false,
        isStarred: false,
      },
      {
        id: "m2",
        threadId: "t2",
        unreadCount: 0,
        isRead: true,
        isStarred: false,
      },
    ],
    total: overrides?.total ?? overrides?.items?.length ?? 2,
    complete: overrides?.complete ?? true,
    clientSnapshotId: overrides?.clientSnapshotId ?? 0,
    syncing: false,
    accounts: [],
    labels: [],
  };
}

function makeClient(seeded: ReturnType<typeof seedResult>) {
  const qc = new QueryClient();
  qc.setQueryData(
    ["action", "list-inbox-threads", { tab: "important" }],
    seeded,
  );
  return qc;
}

function visibleResult(qc: QueryClient) {
  const raw = qc.getQueryData<ReturnType<typeof seedResult>>([
    "action",
    "list-inbox-threads",
    { tab: "important" },
  ])!;
  return applyInboxMutationOverlay(qc, raw as any);
}

describe("keepLatestInboxSnapshot", () => {
  it("keeps a confirmed newer response when an older request resolves last", () => {
    const stale = seedResult({
      clientSnapshotId: 1,
      items: [seedResult().items[0]],
      total: 1,
    });
    const confirmed = seedResult({
      clientSnapshotId: 2,
      items: [seedResult().items[1]],
      total: 1,
    });

    expect(keepLatestInboxSnapshot(stale as any, confirmed as any)).toBe(
      confirmed,
    );
    expect(keepLatestInboxSnapshot(confirmed as any, stale as any)).toBe(
      confirmed,
    );
  });
});

describe("removeInboxThreadsOptimistic", () => {
  it("resolves message ids to the action cache's thread key", () => {
    const qc = makeClient(seedResult());

    expect(findInboxThreadIdByMessageId(qc, "m1")).toBe("t1");
    expect(findInboxThreadIdByMessageId(qc, "missing")).toBeUndefined();
  });

  it("drops the matching threads and decrements only the active tab's counts", () => {
    const qc = makeClient(seedResult());

    removeInboxThreadsOptimistic(qc, new Set(["t1"]));

    const result = visibleResult(qc);

    expect(result.items.map((i) => i.id)).toEqual(["m2"]);
    expect(result.total).toBe(1);
    expect(result.tabs.find((t) => t.id === "important")).toMatchObject({
      total: 2,
      unread: 1,
    });
    // Other tabs are left alone — we can't know their membership client-side.
    expect(result.tabs.find((t) => t.id === "other")).toMatchObject({
      total: 1,
      unread: 1,
    });
  });

  it("never drives a count below zero", () => {
    const qc = makeClient(
      seedResult({
        tabs: [{ id: "important", total: 0, unread: 0 } as any],
        items: [
          {
            id: "m1",
            threadId: "t1",
            unreadCount: 1,
            isRead: false,
            isStarred: false,
          },
        ],
      }),
    );

    removeInboxThreadsOptimistic(qc, new Set(["t1"]));

    const result = visibleResult(qc);
    expect(result.tabs[0]).toMatchObject({ total: 0, unread: 0 });
    expect(result.total).toBe(0);
  });

  it("is a no-op when nothing matches", () => {
    const seeded = seedResult();
    const qc = makeClient(seeded);

    removeInboxThreadsOptimistic(qc, new Set(["not-a-thread"]));

    const result = visibleResult(qc);
    expect(result).toEqual(seeded);
  });
});

describe("markInboxThreadReadOptimistic", () => {
  it("marks a thread read and reduces the active tab's unread count", () => {
    const qc = makeClient(seedResult());

    markInboxThreadReadOptimistic(qc, new Set(["t1"]), true);

    const result = visibleResult(qc);
    const item = result.items.find((i) => i.id === "m1")!;
    expect(item.isRead).toBe(true);
    expect(item.unreadCount).toBe(0);
    expect(result.tabs.find((t) => t.id === "important")?.unread).toBe(1);
  });

  it("marks a thread unread and increases the active tab's unread count", () => {
    const qc = makeClient(seedResult());

    markInboxThreadReadOptimistic(qc, new Set(["t2"]), false);

    const result = visibleResult(qc);
    const item = result.items.find((i) => i.id === "m2")!;
    expect(item.isRead).toBe(false);
    expect(item.unreadCount).toBe(1);
    expect(result.tabs.find((t) => t.id === "important")?.unread).toBe(3);
  });
});

describe("adjustInboxThreadUnreadOptimistic", () => {
  it("marking one unread message read (0/2 → still unread) does not clear the row or cross the tab boundary", () => {
    const qc = makeClient(
      seedResult({
        items: [
          {
            id: "m1",
            threadId: "t1",
            unreadCount: 2,
            isRead: false,
            isStarred: false,
            messageCount: 2,
          },
        ],
      }),
    );

    adjustInboxThreadUnreadOptimistic(qc, "t1", -1);

    const result = visibleResult(qc);
    const item = result.items.find((i) => i.id === "m1")!;
    expect(item.unreadCount).toBe(1);
    expect(item.isRead).toBe(false);
    // No boundary crossed (still unread) — tab count untouched.
    expect(result.tabs.find((t) => t.id === "important")?.unread).toBe(2);
  });

  it("marking the last unread message read crosses to read and decrements the tab count", () => {
    const qc = makeClient(
      seedResult({
        items: [
          {
            id: "m1",
            threadId: "t1",
            unreadCount: 1,
            isRead: false,
            isStarred: false,
            messageCount: 2,
          },
        ],
      }),
    );

    adjustInboxThreadUnreadOptimistic(qc, "t1", -1);

    const result = visibleResult(qc);
    const item = result.items.find((i) => i.id === "m1")!;
    expect(item.unreadCount).toBe(0);
    expect(item.isRead).toBe(true);
    expect(result.tabs.find((t) => t.id === "important")?.unread).toBe(1);
  });

  it("marking a fully-read thread's message unread crosses into unread and increments the tab count", () => {
    const qc = makeClient(
      seedResult({
        items: [
          {
            id: "m1",
            threadId: "t1",
            unreadCount: 0,
            isRead: true,
            isStarred: false,
            messageCount: 2,
          },
        ],
      }),
    );

    adjustInboxThreadUnreadOptimistic(qc, "t1", 1);

    const result = visibleResult(qc);
    const item = result.items.find((i) => i.id === "m1")!;
    expect(item.unreadCount).toBe(1);
    expect(item.isRead).toBe(false);
    expect(result.tabs.find((t) => t.id === "important")?.unread).toBe(3);
  });

  it("clamps unreadCount to [0, messageCount] instead of over/under-flowing", () => {
    const qc = makeClient(
      seedResult({
        items: [
          {
            id: "m1",
            threadId: "t1",
            unreadCount: 0,
            isRead: true,
            isStarred: false,
            messageCount: 2,
          },
        ],
      }),
    );

    // Reading an already-read message must not push unreadCount negative.
    adjustInboxThreadUnreadOptimistic(qc, "t1", -1);

    let result = visibleResult(qc);
    expect(result.items.find((i) => i.id === "m1")?.unreadCount).toBe(0);
    // No change means no crossing — tab count untouched.
    expect(result.tabs.find((t) => t.id === "important")?.unread).toBe(2);

    const fullUnreadClient = makeClient(
      seedResult({
        items: [
          {
            id: "m1",
            threadId: "t1",
            unreadCount: 2,
            isRead: false,
            isStarred: false,
            messageCount: 2,
          },
        ],
      }),
    );

    // Marking unread past messageCount must clamp at messageCount, not exceed it.
    adjustInboxThreadUnreadOptimistic(fullUnreadClient, "t1", 1);

    result = visibleResult(fullUnreadClient);
    expect(result.items.find((i) => i.id === "m1")?.unreadCount).toBe(2);
  });

  it("is a no-op when the threadId doesn't match any cached row", () => {
    const seeded = seedResult({
      items: [
        {
          id: "m1",
          threadId: "t1",
          unreadCount: 1,
          isRead: false,
          isStarred: false,
          messageCount: 2,
        },
      ],
    });
    const qc = makeClient(seeded);

    adjustInboxThreadUnreadOptimistic(qc, "not-a-thread", -1);

    const result = visibleResult(qc);
    expect(result).toEqual(seeded);
  });
});

describe("toggleInboxThreadsStarOptimistic", () => {
  it("flips isStarred without touching tab counts", () => {
    const qc = makeClient(seedResult());

    toggleInboxThreadsStarOptimistic(qc, new Set(["t1"]), true);

    const result = visibleResult(qc);
    expect(result.items.find((i) => i.id === "m1")?.isStarred).toBe(true);
    expect(result.tabs).toEqual(seedResult().tabs);
  });
});

describe("inboxThreadsHasNextPage", () => {
  it("is true while fewer rows are loaded than the tab's total", () => {
    expect(inboxThreadsHasNextPage(100, 250)).toBe(true);
  });

  it("is false once every row is loaded", () => {
    expect(inboxThreadsHasNextPage(250, 250)).toBe(false);
  });

  it("is false when loaded somehow exceeds total (stale total mid-mutation)", () => {
    expect(inboxThreadsHasNextPage(251, 250)).toBe(false);
  });

  it("is false for an empty tab", () => {
    expect(inboxThreadsHasNextPage(0, 0)).toBe(false);
  });
});

describe("mergeInboxThreadPages", () => {
  const item = (id: string) => ({ id, threadId: id }) as any;

  it("concatenates pages in offset order", () => {
    const page0 = { items: [item("a"), item("b")] };
    const page1 = { items: [item("c"), item("d")] };

    expect(mergeInboxThreadPages([page0, page1]).map((i) => i.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("treats a not-yet-fetched page (undefined) as contributing nothing", () => {
    const page0 = { items: [item("a")] };

    expect(mergeInboxThreadPages([page0, undefined]).map((i) => i.id)).toEqual([
      "a",
    ]);
  });

  it("returns an empty array for no pages", () => {
    expect(mergeInboxThreadPages([])).toEqual([]);
  });
});

describe("snapshotInboxThreads / restoreInboxThreadsOptimistic", () => {
  it("restores every cached page an optimistic removal touched", () => {
    const qc = makeClient(seedResult());
    qc.setQueryData(["action", "list-inbox-threads", { tab: "other" }], {
      ...seedResult(),
      activeTabId: "other",
    });

    const snapshot = snapshotInboxThreads(qc);
    const mutationId = removeInboxThreadsOptimistic(qc, new Set(["t1"]));

    // Sanity: the optimistic write actually landed before we roll it back.
    expect(visibleResult(qc).items.map((i) => i.id)).toEqual(["m2"]);

    clearInboxThreadRemoval(qc, "t1", [mutationId]);
    restoreInboxThreadsOptimistic(qc, snapshot);

    for (const tab of ["important", "other"]) {
      const restored = qc.getQueryData<ReturnType<typeof seedResult>>([
        "action",
        "list-inbox-threads",
        { tab },
      ])!;
      expect(restored.items.map((i) => i.id)).toEqual(["m1", "m2"]);
      expect(restored.total).toBe(2);
    }
  });
});

describe("synced inbox mutation consistency", () => {
  it("shows a removed thread immediately after undo clears its journal entry", () => {
    const qc = makeClient(seedResult());
    const mutationId = removeInboxThreadsOptimistic(qc, new Set(["t1"]));

    clearInboxThreadRemoval(qc, "t1", [mutationId]);

    expect(visibleResult(qc).items).toContainEqual(
      expect.objectContaining({ threadId: "t1" }),
    );
  });

  it("retires one overlapping journal entry without restoring another", () => {
    const qc = makeClient(seedResult());
    const removeId = removeInboxThreadsOptimistic(qc, new Set(["t1"]));
    const readId = markInboxThreadReadOptimistic(qc, new Set(["t2"]), false);

    clearInboxThreadRemoval(qc, "t1", [removeId]);
    expect(visibleResult(qc).items.map((item) => item.threadId)).toEqual([
      "t1",
      "t2",
    ]);
    expect(visibleResult(qc).items[1]).toMatchObject({
      isRead: false,
      unreadCount: 1,
    });

    // Keep the second mutation alive until its server evidence arrives.
    expect(readId).toMatch(/^inbox-mutation-/);
  });

  it("undoes only its own same-thread removal", () => {
    const qc = makeClient(seedResult());
    const archiveId = removeInboxThreadsOptimistic(qc, new Set(["t1"]));
    const muteId = removeInboxThreadsOptimistic(qc, new Set(["t1"]));

    clearInboxThreadRemoval(qc, "t1", [archiveId]);
    expect(visibleResult(qc).items).not.toContainEqual(
      expect.objectContaining({ threadId: "t1" }),
    );

    clearInboxThreadRemoval(qc, "t1", [muteId]);
    expect(visibleResult(qc).items).toContainEqual(
      expect.objectContaining({ threadId: "t1" }),
    );
  });

  it("keeps a pending removal past the old timeout ceiling", () => {
    vi.useFakeTimers();
    try {
      const qc = makeClient(seedResult());
      removeInboxThreadsOptimistic(qc, new Set(["t1"]));

      vi.advanceTimersByTime(60_001);

      expect(visibleResult(qc).items).not.toContainEqual(
        expect.objectContaining({ threadId: "t1" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("retires an older read target when a newer target settles", () => {
    const qc = makeClient(seedResult());
    markInboxThreadReadOptimistic(qc, new Set(["t1"]), true);
    const unreadId = markInboxThreadReadOptimistic(qc, new Set(["t1"]), false);

    qc.setQueryData(
      ["action", "list-inbox-threads", { tab: "important" }],
      seedResult(),
    );
    settleInboxMutationIfObserved(qc, unreadId);

    expect(visibleResult(qc).items[0]).toMatchObject({
      isRead: false,
      unreadCount: 1,
    });
  });

  it("supersedes only the overlapping targets in a bulk read mutation", () => {
    const qc = makeClient(seedResult());
    markInboxThreadReadOptimistic(qc, new Set(["t1", "t2"]), true);
    const unreadId = markInboxThreadReadOptimistic(qc, new Set(["t1"]), false);

    qc.setQueryData(
      ["action", "list-inbox-threads", { tab: "important" }],
      seedResult({
        items: [
          { ...seedResult().items[0], isRead: false, unreadCount: 1 },
          { ...seedResult().items[1], isRead: true, unreadCount: 0 },
        ],
      }),
    );
    settleInboxMutationIfObserved(qc, unreadId);

    expect(visibleResult(qc).items).toMatchObject([
      { threadId: "t1", isRead: false, unreadCount: 1 },
      { threadId: "t2", isRead: true, unreadCount: 0 },
    ]);
  });

  it("retains the original sequence when a bulk mutation partially succeeds", () => {
    const qc = makeClient(seedResult());
    const mutationId = markInboxThreadReadOptimistic(
      qc,
      new Set(["t1", "t2"]),
      true,
    );
    const newerId = markInboxThreadReadOptimistic(qc, new Set(["t1"]), false);

    expect(retainInboxMutationTargets(qc, mutationId, new Set(["t2"]))).toBe(
      mutationId,
    );

    const stale = seedResult();
    expect(applyInboxMutationOverlay(qc, stale as any).items).toMatchObject([
      { threadId: "t1", isRead: false, unreadCount: 1 },
      { threadId: "t2", isRead: true, unreadCount: 0 },
    ]);
    expect(newerId).toMatch(/^inbox-mutation-/);
  });

  it("restores a removal journal when an undo action fails", () => {
    const qc = makeClient(seedResult());
    const mutationId = removeInboxThreadsOptimistic(qc, new Set(["t1"]));

    const snapshot = clearInboxThreadRemoval(qc, "t1", [mutationId]);
    restoreInboxThreadRemovals(qc, snapshot);

    expect(
      applyInboxMutationOverlay(qc, seedResult() as any).items,
    ).not.toContainEqual(expect.objectContaining({ threadId: "t1" }));
  });

  it("does not keep cleared undo targets in removal evidence", () => {
    const qc = makeClient(seedResult());
    const mutationId = removeInboxThreadsOptimistic(qc, new Set(["t1", "t2"]));
    clearInboxThreadRemoval(qc, "t1", [mutationId]);

    qc.setQueryData(
      ["action", "list-inbox-threads", { tab: "important" }],
      seedResult({ items: [], clientSnapshotId: 1 }),
    );
    settleInboxMutationIfObserved(qc, mutationId);

    expect(applyInboxMutationOverlay(qc, seedResult() as any).items).toEqual(
      seedResult().items,
    );
  });

  it("keeps a removal journal through a stale refetch and retires it after evidence", () => {
    const qc = makeClient(seedResult());
    const mutationId = removeInboxThreadsOptimistic(qc, new Set(["t1"]));
    const stale = seedResult();

    qc.setQueryData(
      ["action", "list-inbox-threads", { tab: "important" }],
      stale,
    );
    settleInboxMutationIfObserved(qc, mutationId);
    expect(
      applyInboxMutationOverlay(qc, stale as any).items,
    ).not.toContainEqual(expect.objectContaining({ threadId: "t1" }));

    qc.setQueryData(
      ["action", "list-inbox-threads", { tab: "important" }],
      seedResult({ items: [stale.items[1]], clientSnapshotId: 1 }),
    );
    settleInboxMutationIfObserved(qc, mutationId);
    expect(applyInboxMutationOverlay(qc, stale as any).items).toContainEqual(
      expect.objectContaining({ threadId: "t1" }),
    );
  });

  it("does not treat a fresh partial page as removal evidence", () => {
    const qc = makeClient(seedResult({ complete: false, clientSnapshotId: 0 }));
    const mutationId = removeInboxThreadsOptimistic(qc, new Set(["t1"]));

    qc.setQueryData(
      ["action", "list-inbox-threads", { tab: "important" }],
      seedResult({
        items: [seedResult().items[1]],
        total: 2,
        complete: false,
        clientSnapshotId: 1,
      }),
    );
    settleInboxMutationIfObserved(qc, mutationId);
    expect(visibleResult(qc).items).not.toContainEqual(
      expect.objectContaining({ threadId: "t1" }),
    );

    qc.setQueryData(
      ["action", "list-inbox-threads", { tab: "important", offset: 1 }],
      seedResult({
        total: 2,
        items: [{ ...seedResult().items[1], id: "m3", threadId: "t3" }],
        complete: true,
        clientSnapshotId: 1,
      }),
    );
    settleInboxMutationIfObserved(qc, mutationId);
    qc.setQueryData(
      ["action", "list-inbox-threads", { tab: "important" }],
      seedResult({ clientSnapshotId: 2 }),
    );
    expect(visibleResult(qc).items).toContainEqual(
      expect.objectContaining({ threadId: "t1" }),
    );
  });

  it("settles a removal that started before Inbox had any cached target", () => {
    const qc = new QueryClient();
    const mutationId = removeInboxThreadsOptimistic(qc, new Set(["t1"]));

    qc.setQueryData(
      ["action", "list-inbox-threads", { tab: "important" }],
      seedResult({
        items: [seedResult().items[1]],
        total: 1,
        complete: true,
        clientSnapshotId: 1,
      }),
    );
    settleInboxMutationIfObserved(qc, mutationId);

    expect(
      applyInboxMutationOverlay(qc, {
        ...seedResult(),
        items: [seedResult().items[0]],
      } as any).items,
    ).toContainEqual(expect.objectContaining({ threadId: "t1" }));
  });

  it("ignores stale inactive pages when a fresh complete page proves removal", () => {
    const qc = makeClient(seedResult());
    qc.setQueryData(
      ["action", "list-inbox-threads", { tab: "important", offset: 1 }],
      seedResult({
        items: [seedResult().items[0]],
        total: 2,
        complete: true,
        clientSnapshotId: 0,
      }),
    );
    const mutationId = removeInboxThreadsOptimistic(qc, new Set(["t1"]));

    qc.setQueryData(
      ["action", "list-inbox-threads", { tab: "important" }],
      seedResult({
        items: [seedResult().items[1]],
        total: 1,
        complete: true,
        clientSnapshotId: 1,
      }),
    );
    settleInboxMutationIfObserved(qc, mutationId);

    expect(
      applyInboxMutationOverlay(qc, {
        ...seedResult(),
        items: [seedResult().items[0]],
      } as any).items,
    ).toContainEqual(expect.objectContaining({ threadId: "t1" }));
  });

  it("retires overlapping removals independently after fresh evidence", () => {
    const qc = makeClient(seedResult());
    const archiveId = removeInboxThreadsOptimistic(qc, new Set(["t1"]));
    const muteId = removeInboxThreadsOptimistic(qc, new Set(["t1"]));

    qc.setQueryData(
      ["action", "list-inbox-threads", { tab: "important" }],
      seedResult({ items: [seedResult().items[1]], clientSnapshotId: 1 }),
    );
    settleInboxMutationIfObserved(qc, archiveId);
    expect(visibleResult(qc).items).not.toContainEqual(
      expect.objectContaining({ threadId: "t1" }),
    );

    settleInboxMutationIfObserved(qc, muteId);
    qc.setQueryData(
      ["action", "list-inbox-threads", { tab: "important" }],
      seedResult({ clientSnapshotId: 2 }),
    );
    expect(visibleResult(qc).items).toContainEqual(
      expect.objectContaining({ threadId: "t1" }),
    );
  });

  it("does not retire a read target from a pre-mutation matching snapshot", () => {
    const qc = makeClient(seedResult());
    const mutationId = markInboxThreadReadOptimistic(qc, new Set(["t1"]), true);

    qc.setQueryData(
      ["action", "list-inbox-threads", { tab: "important" }],
      seedResult({ clientSnapshotId: 0 }),
    );
    settleInboxMutationIfObserved(qc, mutationId);

    qc.setQueryData(
      ["action", "list-inbox-threads", { tab: "important" }],
      seedResult({
        clientSnapshotId: 1,
        items: [
          { ...seedResult().items[0], isRead: false, unreadCount: 1 },
          seedResult().items[1],
        ],
      }),
    );
    expect(visibleResult(qc).items[0]).toMatchObject({
      isRead: true,
      unreadCount: 0,
    });
    settleInboxMutationIfObserved(qc, mutationId);
    expect(visibleResult(qc).items[0]).toMatchObject({
      isRead: true,
      unreadCount: 0,
    });

    qc.setQueryData(
      ["action", "list-inbox-threads", { tab: "important" }],
      seedResult({
        clientSnapshotId: 2,
        items: [
          { ...seedResult().items[0], isRead: true, unreadCount: 0 },
          seedResult().items[1],
        ],
      }),
    );
    settleInboxMutationIfObserved(qc, mutationId);
    expect(visibleResult(qc).items[0]).toMatchObject({
      isRead: true,
      unreadCount: 0,
    });
  });

  it("replays an absolute unread target without decrementing it twice", () => {
    const qc = makeClient(
      seedResult({
        items: [
          {
            id: "m1",
            threadId: "t1",
            unreadCount: 2,
            isRead: false,
            isStarred: false,
            messageCount: 2,
          },
        ],
      }),
    );
    adjustInboxThreadUnreadOptimistic(qc, "t1", -1);

    const stale = seedResult({
      items: [
        {
          id: "m1",
          threadId: "t1",
          unreadCount: 1,
          isRead: false,
          isStarred: false,
          messageCount: 2,
        },
      ],
    });
    const visible = applyInboxMutationOverlay(qc, stale as any);

    expect(visible.items[0]).toMatchObject({
      isRead: false,
      unreadCount: 1,
    });
  });

  it("replays local changes over a stale server snapshot", () => {
    const qc = makeClient(seedResult());
    const removeId = removeInboxThreadsOptimistic(qc, new Set(["t1"]));
    const readId = markInboxThreadReadOptimistic(qc, new Set(["t2"]), false);

    const stale = seedResult();
    const visible = applyInboxMutationOverlay(qc, stale as any);

    expect(visible.items.map((item) => item.threadId)).toEqual(["t2"]);
    expect(visible.items[0]).toMatchObject({
      isRead: false,
      unreadCount: 1,
    });

    expect(removeId).toMatch(/^inbox-mutation-/);
    expect(readId).toMatch(/^inbox-mutation-/);
  });

  it("cancels every in-flight inbox page before an optimistic write", async () => {
    const qc = new QueryClient();
    const cancel = vi.spyOn(qc, "cancelQueries").mockResolvedValue();

    await cancelInboxThreadsQueries(qc);

    expect(cancel).toHaveBeenCalledWith({
      queryKey: INBOX_THREADS_QUERY_KEY,
    });
  });
});
