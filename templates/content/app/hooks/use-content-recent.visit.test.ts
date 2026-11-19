// @vitest-environment happy-dom

import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRecordContentVisit } from "./use-content-recent";

type VisitResult = {
  recorded: true;
  visitedAt?: string;
  accountKey?: string;
};

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  onSuccess: undefined as
    | ((result: unknown, target: unknown) => void)
    | undefined,
  scheduled: [] as Array<() => void>,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: vi.fn(),
  useActionMutation: (
    _action: string,
    options: { onSuccess?: (result: unknown, target: unknown) => void },
  ) => {
    mocks.onSuccess = options.onSuccess;
    return { mutate: mocks.mutate };
  },
}));

vi.mock("@agent-native/core/client/use-after-paint", () => ({
  scheduleAfterStartup: (callback: () => void) => {
    mocks.scheduled.push(callback);
    return () => {};
  },
}));

vi.mock("@agent-native/core/client/org", () => ({ useOrg: vi.fn() }));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

function entry(documentId: string, visitedAt: string, viewId?: string) {
  return {
    target: viewId
      ? { documentId, databaseId: `db-${documentId}`, viewId }
      : { documentId },
    visitedAt,
    title: documentId,
    icon: null,
    viewName: null,
  };
}

describe("useRecordContentVisit", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.mutate.mockReset();
    mocks.scheduled.length = 0;
    container = document.createElement("div");
    root = createRoot(container);
    queryClient = new QueryClient();
    // The signed-in account and organization, as the org query caches them.
    queryClient.setQueryData(["org-me"], {
      email: "me@example.com",
      orgId: "org-1",
    });
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  function Visit({ documentId }: { documentId: string | null }) {
    useRecordContentVisit(documentId ? { documentId } : null, true);
    return null;
  }

  function render(documentId: string | null) {
    act(() =>
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(Visit, { documentId }),
        ),
      ),
    );
  }

  it("records the visit once the load settles, even after the page closes", () => {
    render("a");
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.scheduled).toHaveLength(1);

    render(null);
    const settle = mocks.scheduled.shift();
    if (!settle) throw new Error("the visit wasn't scheduled");
    settle();
    expect(mocks.mutate).toHaveBeenCalledWith({ documentId: "a" });
  });

  function settleAll() {
    for (const settle of mocks.scheduled.splice(0)) settle();
  }

  it("drops a visit when the organization changes before it's sent", () => {
    render("a");
    expect(mocks.scheduled).toHaveLength(1);

    queryClient.setQueryData(["org-me"], {
      email: "me@example.com",
      orgId: "org-2",
    });
    settleAll();

    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("drops a visit when the account changes or signs out before it's sent", () => {
    render("a");
    queryClient.setQueryData(["org-me"], {
      email: "someone@example.com",
      orgId: "org-1",
    });
    settleAll();
    render("b");
    queryClient.removeQueries({ queryKey: ["org-me"] });
    settleAll();

    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("drops a visit while the organization is being read again after a switch", async () => {
    render("a");
    await queryClient.invalidateQueries({ queryKey: ["org-me"] });
    settleAll();

    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("keeps the organization the page learns of first, even after it opens", () => {
    queryClient.removeQueries({ queryKey: ["org-me"] });
    render("a");
    queryClient.setQueryData(["org-me"], {
      email: "me@example.com",
      orgId: "org-1",
    });
    queryClient.setQueryData(["org-me"], {
      email: "me@example.com",
      orgId: "org-2",
    });
    settleAll();

    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("sends a visit when the organization stays unknown", () => {
    queryClient.removeQueries({ queryKey: ["org-me"] });
    render("a");
    settleAll();

    expect(mocks.mutate).toHaveBeenCalledWith({ documentId: "a" });
  });

  function recentKey(orgId: string | null, spaceId?: string) {
    const scopeKey = JSON.stringify(["me@example.com", orgId, spaceId ?? null]);
    return [
      "action",
      "get-content-recent",
      { scopeKey, ...(spaceId ? { spaceId } : {}) },
    ];
  }

  function cache(key: unknown[], entries: Array<ReturnType<typeof entry>>) {
    const args = key[2] as { scopeKey: string };
    queryClient.setQueryData(key, { scopeKey: args.scopeKey, entries });
  }

  function order(key: unknown[]) {
    return (
      queryClient.getQueryData(key) as {
        entries: Array<{ target: { documentId: string }; visitedAt: string }>;
      }
    ).entries.map((e) => [e.target.documentId, e.visitedAt]);
  }

  // The server answers with the time it stored and the account it stored it
  // under; answers can arrive in any order.
  const ORG_1 = JSON.stringify(["me@example.com", "org-1"]);
  function answer(
    documentId: string,
    result: VisitResult,
    target: object = { documentId },
  ) {
    mocks.onSuccess?.({ accountKey: ORG_1, ...result }, target);
  }

  it("moves a page already in Recent to the server's visit time without a refetch", () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const key = recentKey("org-1");
    cache(key, [
      entry("a", "2026-10-31T10:00:00.000Z"),
      entry("b", "2026-10-30T10:00:00.000Z"),
    ]);
    render("b");

    answer("b", { recorded: true, visitedAt: "2026-10-31T11:00:00.000Z" });

    expect(order(key)).toEqual([
      ["b", "2026-10-31T11:00:00.000Z"],
      ["a", "2026-10-31T10:00:00.000Z"],
    ]);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("keeps the later visit on top when the answers arrive in reverse order", () => {
    const key = recentKey("org-1");
    cache(key, [
      entry("z", "2026-10-31T10:00:00.000Z"),
      entry("x", "2026-10-31T08:00:00.000Z"),
      entry("y", "2026-10-31T07:00:00.000Z"),
    ]);
    render("x");

    // x was visited first, then y; y's answer comes back first.
    answer("y", { recorded: true, visitedAt: "2026-10-31T12:00:02.000Z" });
    answer("x", { recorded: true, visitedAt: "2026-10-31T12:00:01.000Z" });

    expect(order(key)).toEqual([
      ["y", "2026-10-31T12:00:02.000Z"],
      ["x", "2026-10-31T12:00:01.000Z"],
      ["z", "2026-10-31T10:00:00.000Z"],
    ]);
  });

  it("ignores an answer older than the visit the list already shows", () => {
    const key = recentKey("org-1");
    cache(key, [
      entry("b", "2026-10-31T12:00:00.000Z"),
      entry("a", "2026-10-31T11:00:00.000Z"),
    ]);
    render("a");

    answer("a", { recorded: true, visitedAt: "2026-10-31T10:00:00.000Z" });

    expect(order(key)).toEqual([
      ["b", "2026-10-31T12:00:00.000Z"],
      ["a", "2026-10-31T11:00:00.000Z"],
    ]);
  });

  it("reorders the organization's own lists and leaves another organization's alone", () => {
    const own = recentKey("org-1");
    const ownSpace = recentKey("org-1", "space-1");
    const other = recentKey("org-2");
    const lists = [
      entry("a", "2026-10-31T10:00:00.000Z"),
      entry("b", "2026-10-30T10:00:00.000Z"),
    ];
    cache(own, lists);
    cache(ownSpace, lists);
    cache(other, lists);
    render("b");

    answer("b", { recorded: true, visitedAt: "2026-10-31T11:00:00.000Z" });

    const moved = [
      ["b", "2026-10-31T11:00:00.000Z"],
      ["a", "2026-10-31T10:00:00.000Z"],
    ];
    expect(order(own)).toEqual(moved);
    expect(order(ownSpace)).toEqual(moved);
    expect(order(other)).toEqual([
      ["a", "2026-10-31T10:00:00.000Z"],
      ["b", "2026-10-30T10:00:00.000Z"],
    ]);
  });

  it("refetches Recent when a list lacks the page or shows another of its views", () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    cache(recentKey("org-1"), [
      entry("a", "2026-10-31T10:00:00.000Z", "view-1"),
    ]);
    render("new");

    answer("new", { recorded: true, visitedAt: "2026-10-31T11:00:00.000Z" });
    expect(invalidate).toHaveBeenCalledTimes(1);

    answer(
      "a",
      { recorded: true, visitedAt: "2026-10-31T11:00:00.000Z" },
      { documentId: "a", databaseId: "db-a", viewId: "view-2" },
    );
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenLastCalledWith({
      queryKey: ["action", "get-content-recent"],
    });
  });

  it("reads Recent again when a refetch that started before the visit is still in flight", async () => {
    const key = recentKey("org-1");
    const args = key[2] as { scopeKey: string };
    const before = [
      entry("a", "2026-10-31T10:00:00.000Z"),
      entry("b", "2026-10-30T10:00:00.000Z"),
    ];
    const after = [
      entry("b", "2026-10-31T11:00:00.000Z"),
      entry("a", "2026-10-31T10:00:00.000Z"),
    ];
    cache(key, before);
    let answerStale: (() => void) | undefined;
    const reads: string[] = [];
    // The sidebar's list: the first refetch read the list before the visit
    // was stored and answers late; any later read sees the visit.
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      staleTime: Infinity,
      queryFn: () => {
        reads.push(reads.length === 0 ? "stale" : "fresh");
        if (reads.length === 1) {
          return new Promise((resolve) => {
            answerStale = () =>
              resolve({ scopeKey: args.scopeKey, entries: before });
          });
        }
        return Promise.resolve({ scopeKey: args.scopeKey, entries: after });
      },
    });
    const unsubscribe = observer.subscribe(() => {});
    void observer.refetch();
    render("b");

    answer("b", { recorded: true, visitedAt: "2026-10-31T11:00:00.000Z" });
    await vi.waitFor(() =>
      expect(order(key)[0]).toEqual(["b", "2026-10-31T11:00:00.000Z"]),
    );

    if (!answerStale) throw new Error("the refetch didn't start");
    answerStale();
    await vi.waitFor(() =>
      expect(queryClient.isFetching({ queryKey: key })).toBe(0),
    );

    expect(order(key)).toEqual([
      ["b", "2026-10-31T11:00:00.000Z"],
      ["a", "2026-10-31T10:00:00.000Z"],
    ]);
    expect(reads).toEqual(["stale", "fresh"]);
    unsubscribe();
  });

  it("refetches Recent when a list has no data yet", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    cache(recentKey("org-1"), [
      entry("a", "2026-10-31T10:00:00.000Z"),
      entry("b", "2026-10-30T10:00:00.000Z"),
    ]);
    // The space's list failed its first read, so it holds no data and
    // isn't fetching.
    await queryClient.prefetchQuery({
      queryKey: recentKey("org-1", "space-1"),
      queryFn: () => Promise.reject(new Error("offline")),
    });
    render("b");

    answer("b", { recorded: true, visitedAt: "2026-10-31T11:00:00.000Z" });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["action", "get-content-recent"],
    });
  });

  it("restarts a first Recent read in flight instead of keeping its answer", async () => {
    const key = recentKey("org-1");
    const args = key[2] as { scopeKey: string };
    const reads: string[] = [];
    let answerStale: (() => void) | undefined;
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: () => {
        reads.push(reads.length === 0 ? "stale" : "fresh");
        if (reads.length === 1) {
          return new Promise((resolve) => {
            answerStale = () =>
              resolve({
                scopeKey: args.scopeKey,
                entries: [entry("a", "2026-10-31T10:00:00.000Z")],
              });
          });
        }
        return Promise.resolve({
          scopeKey: args.scopeKey,
          entries: [
            entry("b", "2026-10-31T11:00:00.000Z"),
            entry("a", "2026-10-31T10:00:00.000Z"),
          ],
        });
      },
    });
    const unsubscribe = observer.subscribe(() => {});
    render("b");

    answer("b", { recorded: true, visitedAt: "2026-10-31T11:00:00.000Z" });
    answerStale?.();
    await vi.waitFor(() => {
      expect(reads).toHaveLength(2);
      expect(queryClient.isFetching({ queryKey: key })).toBe(0);
    });

    expect(order(key)).toEqual([
      ["b", "2026-10-31T11:00:00.000Z"],
      ["a", "2026-10-31T10:00:00.000Z"],
    ]);
    expect(reads).toEqual(["stale", "fresh"]);
    unsubscribe();
  });
});
