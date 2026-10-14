// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Session = { email: string; userId: string; orgId: string };

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  recordQueryCost: vi.fn(),
  status: "authenticated" as string,
  session: null as Session | null,
  signingOut: false,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
  isSigningOut: () => mocks.signingOut,
  useSession: () => ({ session: mocks.session, status: mocks.status }),
}));
vi.mock("./cost-tracker", () => ({
  recordQueryCost: mocks.recordQueryCost,
}));

import { useSqlQuery, type SqlQueryResult } from "./sql-query";
import {
  readSqlQuerySnapshot,
  writeSqlQuerySnapshot,
  SQL_QUERY_SNAPSHOT_MAX_AGE_MS,
} from "./sql-query-cache";
import {
  resetSqlQuerySnapshotSessionForTests,
  syncSqlQuerySnapshotsToSession,
} from "./sql-query-snapshot-session";

const USER_A: Session = {
  email: "a@example.com",
  userId: "user-a",
  orgId: "org-1",
};
const SCOPE_A = "user-a:org-1";
const USER_B: Session = {
  email: "b@example.com",
  userId: "user-b",
  orgId: "org-1",
};
const SCOPE_B = "user-b:org-1";

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

const snapshotKey = (sql: string, source = "bigquery") =>
  JSON.stringify([["sql", sql], sql, source]);

function seed(
  sql: string,
  result: SqlQueryResult,
  options: { scope?: string; now?: number } = {},
) {
  const write = writeSqlQuerySnapshot({
    accountScope: options.scope ?? SCOPE_A,
    queryKey: snapshotKey(sql),
    result,
    now: options.now,
  });
  expect(write.status).toBe("written");
}

function savedFetchedAt(sql: string, scope = SCOPE_A) {
  const read = readSqlQuerySnapshot({
    accountScope: scope,
    queryKey: snapshotKey(sql),
  });
  return read.status === "hit" ? read.snapshot.result.fetchedAt : read.status;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function Probe({
  sql,
  enabled = true,
  refreshToken = 0,
  retainWhilePaused = false,
  source = "bigquery",
}: {
  sql: string;
  enabled?: boolean;
  refreshToken?: number;
  retainWhilePaused?: boolean;
  source?: "bigquery" | "ga4";
}) {
  const query = useSqlQuery(["sql", sql], sql, source, {
    enabled,
    refreshToken,
    retainWhilePaused,
    retainPreviousScope: "panel",
    reuseCompletedOnEnable: true,
    snapshots: true,
  });
  return (
    <output>
      {JSON.stringify({
        rows: query.data?.rows ?? null,
        cache: query.freshness?.cache ?? null,
        fetchedAt: query.freshness?.fetchedAt ?? null,
        error: query.error?.message ?? null,
        fetching: query.isFetching,
        previous: query.isPlaceholderData,
      })}
    </output>
  );
}

describe("useSqlQuery saved results", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  const state = () =>
    JSON.parse(container.querySelector("output")?.textContent ?? "null") as {
      rows: Record<string, unknown>[] | null;
      cache: string | null;
      fetchedAt: string | null;
      error: string | null;
      fetching: boolean;
      previous: boolean;
    };
  const render = (props: Parameters<typeof Probe>[0]) =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe {...props} />
      </QueryClientProvider>,
    );
  const signIn = (session: Session = USER_A) => {
    mocks.status = "authenticated";
    mocks.session = session;
    syncSqlQuerySnapshotsToSession({ status: "authenticated", session });
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.sessionStorage.clear();
    resetSqlQuerySnapshotSessionForTests();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mocks.callAction.mockReset();
    mocks.recordQueryCost.mockReset();
    mocks.signingOut = false;
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    signIn();
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the saved rows at once and revalidates once with a normal request", async () => {
    const savedAt = minutesAgo(30);
    seed("SELECT 1", { rows: [{ n: 1 }], cached: false, fetchedAt: savedAt });
    const request = deferred<SqlQueryResult>();
    mocks.callAction.mockReturnValue(request.promise);

    await act(async () => render({ sql: "SELECT 1" }));

    expect(state()).toMatchObject({
      rows: [{ n: 1 }],
      cache: "restored",
      fetchedAt: savedAt,
      fetching: true,
      previous: false,
    });
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
    expect(mocks.callAction.mock.calls[0]?.[1]).toEqual({
      query: "SELECT 1",
      source: "bigquery",
    });

    const freshAt = minutesAgo(0);
    await act(async () => {
      request.resolve({
        rows: [{ n: 2 }],
        cached: false,
        providerCacheHit: false,
        fetchedAt: freshAt,
        bytesProcessed: 1024,
      } as SqlQueryResult);
    });

    await vi.waitFor(() =>
      expect(state()).toMatchObject({
        rows: [{ n: 2 }],
        cache: "live",
        fetchedAt: freshAt,
        fetching: false,
      }),
    );
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
    expect(mocks.recordQueryCost).toHaveBeenCalledTimes(1);
    expect(savedFetchedAt("SELECT 1")).toBe(freshAt);
  });

  it("keeps the saved copy, its original time and the error when revalidation fails", async () => {
    const savedAt = minutesAgo(30);
    seed("SELECT 1", { rows: [{ n: 1 }], fetchedAt: savedAt });
    mocks.callAction.mockRejectedValue(new Error("warehouse unreachable"));

    await act(async () => render({ sql: "SELECT 1" }));

    await vi.waitFor(() =>
      expect(state()).toMatchObject({
        rows: [{ n: 1 }],
        cache: "restored",
        fetchedAt: savedAt,
        error: "warehouse unreachable",
        fetching: false,
      }),
    );
    expect(savedFetchedAt("SELECT 1")).toBe(savedAt);
  });

  it("does not query again when the exact result is already in memory", async () => {
    seed("SELECT 1", { rows: [{ n: 99 }], fetchedAt: minutesAgo(30) });
    queryClient.setQueryData(["sql", "SELECT 1", SCOPE_A], {
      rows: [{ n: 1 }],
      fetchedAt: minutesAgo(1),
      providerCacheHit: false,
    });

    await act(async () => render({ sql: "SELECT 1" }));

    expect(state()).toMatchObject({ rows: [{ n: 1 }], cache: "live" });
    expect(mocks.callAction).not.toHaveBeenCalled();
  });

  it("renders a saved copy for a paused panel without a request, then fetches once when it is shown", async () => {
    const savedAt = minutesAgo(30);
    seed("SELECT 1", { rows: [{ n: 1 }], fetchedAt: savedAt });
    mocks.callAction.mockResolvedValue({
      rows: [{ n: 2 }],
      providerCacheHit: false,
      fetchedAt: minutesAgo(0),
    });

    await act(async () =>
      render({ sql: "SELECT 1", enabled: false, retainWhilePaused: true }),
    );
    expect(state()).toMatchObject({ rows: [{ n: 1 }], cache: "restored" });
    expect(mocks.callAction).not.toHaveBeenCalled();

    await act(async () =>
      render({ sql: "SELECT 1", enabled: true, retainWhilePaused: true }),
    );
    await vi.waitFor(() =>
      expect(state()).toMatchObject({ rows: [{ n: 2 }], cache: "live" }),
    );
    expect(mocks.callAction).toHaveBeenCalledTimes(1);

    // Scrolling away and back must not scan the same query again.
    await act(async () =>
      render({ sql: "SELECT 1", enabled: false, retainWhilePaused: true }),
    );
    await act(async () =>
      render({ sql: "SELECT 1", enabled: true, retainWhilePaused: true }),
    );
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
    expect(state()).toMatchObject({ rows: [{ n: 2 }], cache: "live" });
  });

  it("restores a copy only for the same account, SQL and source", async () => {
    seed("SELECT 1", { rows: [{ n: "other-account" }] }, { scope: SCOPE_B });
    seed("SELECT 2", { rows: [{ n: "other-sql" }] });
    mocks.callAction.mockReturnValue(new Promise(() => {}));

    await act(async () => render({ sql: "SELECT 1" }));
    expect(state().rows).toBeNull();

    await act(async () => render({ sql: "SELECT 1", source: "ga4" }));
    expect(state().rows).toBeNull();
    expect(mocks.callAction).toHaveBeenCalled();
  });

  it("reads and clears nothing before the session is authenticated", async () => {
    seed("SELECT 1", { rows: [{ n: 1 }], fetchedAt: minutesAgo(5) });
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    mocks.status = "loading";
    mocks.session = null;

    await act(async () => render({ sql: "SELECT 1" }));

    expect(state().rows).toBeNull();
    expect(mocks.callAction).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    expect(savedFetchedAt("SELECT 1")).toEqual(expect.any(String));
  });

  it("falls back to a normal fetch for an expired, corrupt or unreadable copy", async () => {
    const now = Date.now();
    seed(
      "SELECT 1",
      { rows: [{ n: "expired" }] },
      { now: now - SQL_QUERY_SNAPSHOT_MAX_AGE_MS - 60_000 },
    );
    mocks.callAction.mockResolvedValue({ rows: [{ n: "live" }] });
    await act(async () => render({ sql: "SELECT 1" }));
    await vi.waitFor(() => expect(state().rows).toEqual([{ n: "live" }]));
    expect(mocks.callAction).toHaveBeenCalledTimes(1);

    // A stored value that is not a saved result is dropped with a warning.
    const corruptKey = Object.keys(window.sessionStorage).find((key) =>
      key.startsWith("an-sql-snapshot/"),
    );
    expect(corruptKey).toBeDefined();
    window.sessionStorage.setItem(corruptKey!, "{not json");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    queryClient.clear();
    mocks.callAction.mockClear();
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => render({ sql: "SELECT 1" }));
    await vi.waitFor(() => expect(mocks.callAction).toHaveBeenCalledTimes(1));
    expect(warn).toHaveBeenCalledWith(
      "[sql-query] dropped an unusable saved result",
      { reason: "corrupt" },
    );
  });

  it("fetches normally and warns when session storage is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    mocks.callAction.mockResolvedValue({ rows: [{ n: 1 }] });

    await act(async () => render({ sql: "SELECT 1" }));

    await vi.waitFor(() => expect(state().rows).toEqual([{ n: 1 }]));
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[sql-query] saved results unavailable", {
      reason: "storage-error",
      errorName: "SecurityError",
    });
  });

  it("drops the previous copy instead of keeping it when the new result is truncated", async () => {
    seed("SELECT 1", { rows: [{ n: "old" }], fetchedAt: minutesAgo(30) });
    mocks.callAction.mockResolvedValue({
      rows: [{ n: "partial" }],
      truncated: true,
      fetchedAt: minutesAgo(0),
    });

    await act(async () => render({ sql: "SELECT 1" }));

    await vi.waitFor(() => expect(state().rows).toEqual([{ n: "partial" }]));
    expect(savedFetchedAt("SELECT 1")).toBe("miss");
  });

  it("sends a manual refresh once with forceRefresh and saves the new fetch time", async () => {
    mocks.callAction.mockResolvedValueOnce({
      rows: [{ n: 1 }],
      cached: true,
      fetchedAt: minutesAgo(30),
    });
    await act(async () => render({ sql: "SELECT 1" }));
    await vi.waitFor(() => expect(state().cache).toBe("app-cache"));

    const refreshedAt = minutesAgo(0);
    mocks.callAction.mockResolvedValueOnce({
      rows: [{ n: 2 }],
      cached: false,
      providerCacheHit: false,
      fetchedAt: refreshedAt,
    });
    await act(async () => render({ sql: "SELECT 1", refreshToken: 1 }));

    await vi.waitFor(() =>
      expect(state()).toMatchObject({
        rows: [{ n: 2 }],
        cache: "live",
        fetchedAt: refreshedAt,
      }),
    );
    expect(mocks.callAction).toHaveBeenCalledTimes(2);
    expect(mocks.callAction.mock.calls[0]?.[1]).not.toHaveProperty(
      "forceRefresh",
    );
    expect(mocks.callAction.mock.calls[1]?.[1]).toEqual({
      query: "SELECT 1",
      source: "bigquery",
      forceRefresh: true,
    });
    expect(savedFetchedAt("SELECT 1")).toBe(refreshedAt);

    await act(async () => render({ sql: "SELECT 1", refreshToken: 1 }));
    expect(mocks.callAction).toHaveBeenCalledTimes(2);
  });

  it("does not let a failed forced refresh of one query force the next, different query", async () => {
    mocks.callAction.mockResolvedValueOnce({ rows: [{ q: "A" }] });
    await act(async () => render({ sql: "SELECT A" }));
    await vi.waitFor(() => expect(state().rows).toEqual([{ q: "A" }]));

    mocks.callAction.mockRejectedValueOnce(new Error("refresh of A failed"));
    await act(async () => render({ sql: "SELECT A", refreshToken: 1 }));
    await vi.waitFor(() => expect(state().error).toBe("refresh of A failed"));
    expect(mocks.callAction.mock.calls[1]?.[1]).toMatchObject({
      forceRefresh: true,
    });

    // A filter change loads B as an ordinary query served from the caches.
    mocks.callAction.mockResolvedValueOnce({ rows: [{ q: "B" }] });
    await act(async () => render({ sql: "SELECT B", refreshToken: 1 }));
    await vi.waitFor(() => expect(state().rows).toEqual([{ q: "B" }]));
    expect(mocks.callAction.mock.calls[2]?.[1]).toEqual({
      query: "SELECT B",
      source: "bigquery",
    });

    // An explicit refresh of B bypasses the caches exactly once.
    mocks.callAction.mockResolvedValueOnce({ rows: [{ q: "B2" }] });
    await act(async () => render({ sql: "SELECT B", refreshToken: 2 }));
    await vi.waitFor(() => expect(state().rows).toEqual([{ q: "B2" }]));
    expect(mocks.callAction.mock.calls[3]?.[1]).toEqual({
      query: "SELECT B",
      source: "bigquery",
      forceRefresh: true,
    });
    await act(async () => render({ sql: "SELECT B", refreshToken: 2 }));
    expect(mocks.callAction).toHaveBeenCalledTimes(4);
  });

  it("does not turn a remount with an old refresh token into a forced refresh", async () => {
    mocks.callAction.mockResolvedValue({ rows: [{ n: 1 }] });

    await act(async () => render({ sql: "SELECT 1", refreshToken: 3 }));

    await vi.waitFor(() => expect(state().rows).toEqual([{ n: 1 }]));
    expect(mocks.callAction.mock.calls[0]?.[1]).not.toHaveProperty(
      "forceRefresh",
    );
  });

  it("does not save a result that arrives after sign-out began", async () => {
    const request = deferred<SqlQueryResult>();
    mocks.callAction.mockReturnValue(request.promise);
    await act(async () => render({ sql: "SELECT 1" }));

    mocks.signingOut = true;
    syncSqlQuerySnapshotsToSession({ status: "signing-out", session: null });
    mocks.status = "signing-out";
    mocks.session = null;
    await act(async () => {
      request.resolve({ rows: [{ n: 1 }], fetchedAt: minutesAgo(0) });
    });

    expect(savedFetchedAt("SELECT 1")).toBe("miss");
  });

  it("does not save a result for the previous account after a switch", async () => {
    const request = deferred<SqlQueryResult>();
    mocks.callAction.mockReturnValue(request.promise);
    await act(async () => render({ sql: "SELECT 1" }));

    signIn(USER_B);
    await act(async () => {
      request.resolve({ rows: [{ n: 1 }], fetchedAt: minutesAgo(0) });
    });

    expect(savedFetchedAt("SELECT 1", SCOPE_A)).toBe("miss");
    expect(savedFetchedAt("SELECT 1", SCOPE_B)).toBe("miss");
  });

  it("does not save a result that completes after its query was cancelled", async () => {
    const request = deferred<SqlQueryResult>();
    mocks.callAction.mockReturnValue(request.promise);
    await act(async () => render({ sql: "SELECT 1" }));
    await vi.waitFor(() => expect(mocks.callAction).toHaveBeenCalled());

    act(() => root.unmount());
    await act(async () => {
      request.resolve({ rows: [{ n: 1 }], fetchedAt: minutesAgo(0) });
    });

    expect(savedFetchedAt("SELECT 1")).toBe("miss");
    root = createRoot(container);
  });

  it("keeps what it saved when the app unmounts without a sign-out", async () => {
    mocks.callAction.mockResolvedValue({
      rows: [{ n: 1 }],
      fetchedAt: minutesAgo(1),
    });
    await act(async () => render({ sql: "SELECT 1" }));
    await vi.waitFor(() => expect(state().rows).toEqual([{ n: 1 }]));

    act(() => root.unmount());

    expect(savedFetchedAt("SELECT 1")).toEqual(expect.any(String));
    root = createRoot(container);
  });
});
