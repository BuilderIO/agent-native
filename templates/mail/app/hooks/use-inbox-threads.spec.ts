import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  inboxThreadsHasNextPage,
  markInboxThreadReadOptimistic,
  mergeInboxThreadPages,
  removeInboxThreadsOptimistic,
  resolveInboxTabId,
  restoreInboxThreadsOptimistic,
  snapshotInboxThreads,
  toggleInboxThreadsStarOptimistic,
} from "./use-inbox-threads";

describe("resolveInboxTabId", () => {
  it("returns undefined with no params so the server defaults to its first tab", () => {
    expect(resolveInboxTabId(new URLSearchParams())).toBeUndefined();
  });

  it("passes a `tab` param straight through, including the `other` sentinel", () => {
    expect(resolveInboxTabId(new URLSearchParams("tab=important"))).toBe(
      "important",
    );
    expect(resolveInboxTabId(new URLSearchParams("tab=other"))).toBe("other");
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
  }>;
  activeTabId?: string;
  tabs?: Array<{ id: string; total: number; unread: number }>;
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
    total: overrides?.items?.length ?? 2,
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

describe("removeInboxThreadsOptimistic", () => {
  it("drops the matching threads and decrements only the active tab's counts", () => {
    const qc = makeClient(seedResult());

    removeInboxThreadsOptimistic(qc, new Set(["t1"]));

    const result = qc.getQueryData<ReturnType<typeof seedResult>>([
      "action",
      "list-inbox-threads",
      { tab: "important" },
    ])!;

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

    const result = qc.getQueryData<ReturnType<typeof seedResult>>([
      "action",
      "list-inbox-threads",
      { tab: "important" },
    ])!;
    expect(result.tabs[0]).toMatchObject({ total: 0, unread: 0 });
    expect(result.total).toBe(0);
  });

  it("is a no-op when nothing matches", () => {
    const seeded = seedResult();
    const qc = makeClient(seeded);

    removeInboxThreadsOptimistic(qc, new Set(["not-a-thread"]));

    const result = qc.getQueryData<ReturnType<typeof seedResult>>([
      "action",
      "list-inbox-threads",
      { tab: "important" },
    ])!;
    expect(result).toEqual(seeded);
  });
});

describe("markInboxThreadReadOptimistic", () => {
  it("marks a thread read and reduces the active tab's unread count", () => {
    const qc = makeClient(seedResult());

    markInboxThreadReadOptimistic(qc, new Set(["t1"]), true);

    const result = qc.getQueryData<ReturnType<typeof seedResult>>([
      "action",
      "list-inbox-threads",
      { tab: "important" },
    ])!;
    const item = result.items.find((i) => i.id === "m1")!;
    expect(item.isRead).toBe(true);
    expect(item.unreadCount).toBe(0);
    expect(result.tabs.find((t) => t.id === "important")?.unread).toBe(1);
  });

  it("marks a thread unread and increases the active tab's unread count", () => {
    const qc = makeClient(seedResult());

    markInboxThreadReadOptimistic(qc, new Set(["t2"]), false);

    const result = qc.getQueryData<ReturnType<typeof seedResult>>([
      "action",
      "list-inbox-threads",
      { tab: "important" },
    ])!;
    const item = result.items.find((i) => i.id === "m2")!;
    expect(item.isRead).toBe(false);
    expect(item.unreadCount).toBe(1);
    expect(result.tabs.find((t) => t.id === "important")?.unread).toBe(3);
  });
});

describe("toggleInboxThreadsStarOptimistic", () => {
  it("flips isStarred without touching tab counts", () => {
    const qc = makeClient(seedResult());

    toggleInboxThreadsStarOptimistic(qc, new Set(["t1"]), true);

    const result = qc.getQueryData<ReturnType<typeof seedResult>>([
      "action",
      "list-inbox-threads",
      { tab: "important" },
    ])!;
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
    removeInboxThreadsOptimistic(qc, new Set(["t1"]));

    // Sanity: the optimistic write actually landed before we roll it back.
    expect(
      qc
        .getQueryData<ReturnType<typeof seedResult>>([
          "action",
          "list-inbox-threads",
          { tab: "important" },
        ])!
        .items.map((i) => i.id),
    ).toEqual(["m2"]);

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
