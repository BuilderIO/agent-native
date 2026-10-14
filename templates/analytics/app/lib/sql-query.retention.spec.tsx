// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SessionStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "unavailable"
  | "signing-out";

const mocks = vi.hoisted(() => ({
  addBytesProcessed: vi.fn(),
  callAction: vi.fn(),
  session: {
    session: null as {
      email: string;
      userId: string;
      orgId?: string;
    } | null,
    status: "authenticated" as SessionStatus,
  },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
  useSession: () => mocks.session,
}));

vi.mock("./cost-tracker", () => ({
  addBytesProcessed: mocks.addBytesProcessed,
}));

import { useSqlQuery } from "./sql-query";

const userA = { email: "a@example.com", userId: "user-a", orgId: "org-1" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// An unanswered request must end with its query, or it holds one of the shared
// request slots for the rest of the file.
const unanswered = (
  _name: string,
  _args: unknown,
  options: { signal: AbortSignal },
) =>
  new Promise((_resolve, reject) =>
    options.signal.addEventListener("abort", () =>
      reject(new Error("aborted")),
    ),
  );

type Snapshot = {
  rows: unknown;
  placeholder: boolean;
  fetching: boolean;
  loading: boolean;
  error: string | null;
};

describe("useSqlQuery retained results", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let latest: Snapshot;

  function Probe({
    sql,
    scope = "view-1",
    enabled = true,
    refreshToken = 0,
  }: {
    sql: string;
    scope?: string;
    enabled?: boolean;
    refreshToken?: number;
  }) {
    const query = useSqlQuery(["sql", "panel-1", sql], sql, "bigquery", {
      enabled,
      refreshToken,
      retainPreviousScope: scope,
    });
    latest = {
      rows: query.data?.rows,
      placeholder: query.isPlaceholderData,
      fetching: query.isFetching,
      loading: query.isLoading,
      error: query.error?.message ?? null,
    };
    return null;
  }

  const render = (props: Parameters<typeof Probe>[0]) =>
    act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe {...props} />
        </QueryClientProvider>,
      );
    });

  const settle = () =>
    vi.waitFor(() => {
      expect(latest.fetching).toBe(false);
    });

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mocks.addBytesProcessed.mockReset();
    mocks.callAction.mockReset();
    mocks.session.session = userA;
    mocks.session.status = "authenticated";
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  const answers = (rowsBySql: Record<string, unknown>) =>
    mocks.callAction.mockImplementation((_name, args) =>
      Promise.resolve({ rows: [rowsBySql[args.query]], schema: [] }),
    );

  it("keeps the last rows, marked as previous, while a new filter loads", async () => {
    const next = deferred<{ rows: unknown[]; schema: [] }>();
    mocks.callAction.mockImplementation((_name, args) =>
      args.query === "A"
        ? Promise.resolve({ rows: [{ v: "a" }], schema: [] })
        : next.promise,
    );

    await render({ sql: "A" });
    await settle();
    expect(latest.rows).toEqual([{ v: "a" }]);
    expect(latest.placeholder).toBe(false);

    await render({ sql: "B" });
    expect(latest.rows).toEqual([{ v: "a" }]);
    expect(latest.placeholder).toBe(true);
    expect(latest.fetching).toBe(true);
    expect(latest.loading).toBe(false);

    await act(async () => next.resolve({ rows: [{ v: "b" }], schema: [] }));
    await vi.waitFor(() => expect(latest.rows).toEqual([{ v: "b" }]));
    expect(latest.placeholder).toBe(false);
    expect(latest.fetching).toBe(false);
  });

  it("keeps the previous rows beside the error when the new filter fails", async () => {
    mocks.callAction.mockImplementation((_name, args) =>
      args.query === "A"
        ? Promise.resolve({ rows: [{ v: "a" }], schema: [] })
        : Promise.reject(new Error("filter B failed")),
    );

    await render({ sql: "A" });
    await settle();
    await render({ sql: "B" });
    await settle();

    expect(latest.error).toBe("filter B failed");
    expect(latest.rows).toEqual([{ v: "a" }]);
    expect(latest.placeholder).toBe(true);
    expect(latest.fetching).toBe(false);
  });

  it("retries the failed filter without discarding the previous rows", async () => {
    let attempts = 0;
    mocks.callAction.mockImplementation((_name, args) => {
      if (args.query === "A") {
        return Promise.resolve({ rows: [{ v: "a" }], schema: [] });
      }
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("filter B failed"))
        : Promise.resolve({ rows: [{ v: "b" }], schema: [] });
    });

    await render({ sql: "A" });
    await settle();
    await render({ sql: "B" });
    await settle();
    expect(latest.error).toBe("filter B failed");

    await render({ sql: "B", refreshToken: 1 });
    await vi.waitFor(() => expect(latest.rows).toEqual([{ v: "b" }]));
    expect(latest.placeholder).toBe(false);
    expect(latest.error).toBeNull();
  });

  it("returns to a filter's own cached rows without a placeholder", async () => {
    answers({ A: { v: "a" }, B: { v: "b" } });
    await render({ sql: "A" });
    await settle();
    await render({ sql: "B" });
    await settle();
    mocks.callAction.mockClear();

    await render({ sql: "A" });
    expect(latest.rows).toEqual([{ v: "a" }]);
    expect(latest.placeholder).toBe(false);
    expect(mocks.callAction).not.toHaveBeenCalled();
  });

  it("keeps a completed empty result instead of treating it as absent", async () => {
    mocks.callAction.mockImplementation((_name, args, options) =>
      args.query === "A"
        ? Promise.resolve({ rows: [], schema: [] })
        : unanswered(_name, args, options),
    );

    await render({ sql: "A" });
    await settle();
    expect(latest.rows).toEqual([]);

    await render({ sql: "B" });
    expect(latest.rows).toEqual([]);
    expect(latest.placeholder).toBe(true);
    expect(latest.loading).toBe(false);
  });

  it("does not retain rows across a different chart view", async () => {
    answers({ A: { v: "a" } });
    await render({ sql: "A", scope: "view-1" });
    await settle();

    mocks.callAction.mockImplementation(unanswered);
    await render({ sql: "B", scope: "view-2" });
    expect(latest.rows).toBeUndefined();
    expect(latest.placeholder).toBe(false);
    expect(latest.loading).toBe(true);
  });

  it("does not retain rows while the query is disabled", async () => {
    answers({ A: { v: "a" } });
    await render({ sql: "A" });
    await settle();

    await render({ sql: "B", enabled: false });
    expect(latest.rows).toBeUndefined();
    expect(latest.placeholder).toBe(false);
  });

  it("keeps rows visible while the same query refreshes, forcing the refresh", async () => {
    const refreshed = deferred<{ rows: unknown[]; schema: [] }>();
    mocks.callAction.mockImplementationOnce(() =>
      Promise.resolve({ rows: [{ v: "a" }], schema: [] }),
    );
    mocks.callAction.mockImplementationOnce(() => refreshed.promise);

    await render({ sql: "A" });
    await settle();
    await render({ sql: "A", refreshToken: 1 });
    await vi.waitFor(() => expect(latest.fetching).toBe(true));

    expect(mocks.callAction).toHaveBeenCalledTimes(2);
    expect(latest.rows).toEqual([{ v: "a" }]);
    expect(latest.placeholder).toBe(false);
    expect(mocks.callAction.mock.calls[1]?.[1]).toEqual({
      query: "A",
      source: "bigquery",
      forceRefresh: true,
    });

    await act(async () =>
      refreshed.resolve({ rows: [{ v: "a2" }], schema: [] }),
    );
    await vi.waitFor(() => expect(latest.rows).toEqual([{ v: "a2" }]));
  });

  it("keeps rows beside the error when a same-query refresh fails", async () => {
    mocks.callAction.mockImplementationOnce(() =>
      Promise.resolve({ rows: [{ v: "a" }], schema: [] }),
    );
    mocks.callAction.mockImplementationOnce(() =>
      Promise.reject(new Error("refresh failed")),
    );

    await render({ sql: "A" });
    await settle();
    await render({ sql: "A", refreshToken: 1 });
    await vi.waitFor(() => expect(latest.error).toBe("refresh failed"));

    expect(latest.rows).toEqual([{ v: "a" }]);
    expect(latest.placeholder).toBe(false);
  });

  describe("account boundary", () => {
    it("never shows or retains rows across a user switch", async () => {
      answers({ A: { v: "a" } });
      await render({ sql: "A" });
      await settle();
      expect(latest.rows).toEqual([{ v: "a" }]);

      const userB = deferred<{ rows: unknown[]; schema: [] }>();
      mocks.callAction.mockImplementation(() => userB.promise);
      mocks.session.session = {
        email: "b@example.com",
        userId: "user-b",
        orgId: "org-1",
      };
      await render({ sql: "A" });

      expect(latest.rows).toBeUndefined();
      expect(latest.placeholder).toBe(false);
      expect(latest.loading).toBe(true);
      expect(mocks.callAction).toHaveBeenCalledTimes(2);

      await act(async () => userB.resolve({ rows: [{ v: "b" }], schema: [] }));
      await vi.waitFor(() => expect(latest.rows).toEqual([{ v: "b" }]));
    });

    it("never shows or retains rows across an org switch of the same user", async () => {
      answers({ A: { v: "a" }, B: { v: "b" } });
      await render({ sql: "A" });
      await settle();

      mocks.callAction.mockImplementation(unanswered);
      mocks.session.session = { ...userA, orgId: "org-2" };
      await render({ sql: "B" });

      expect(latest.rows).toBeUndefined();
      expect(latest.placeholder).toBe(false);
    });

    it("returns each account its own cached rows for the same SQL", async () => {
      answers({ A: { v: "org-1" } });
      await render({ sql: "A" });
      await settle();

      answers({ A: { v: "org-2" } });
      mocks.session.session = { ...userA, orgId: "org-2" };
      await render({ sql: "A" });
      await settle();
      expect(latest.rows).toEqual([{ v: "org-2" }]);

      mocks.callAction.mockClear();
      mocks.session.session = userA;
      await render({ sql: "A" });
      expect(latest.rows).toEqual([{ v: "org-1" }]);
      expect(mocks.callAction).not.toHaveBeenCalled();
    });

    it("drops an earlier account's slow response instead of adopting it", async () => {
      const slowForA = deferred<{ rows: unknown[]; schema: [] }>();
      mocks.callAction.mockImplementationOnce(() => slowForA.promise);
      await render({ sql: "A" });

      mocks.session.session = {
        email: "b@example.com",
        userId: "user-b",
        orgId: "org-1",
      };
      mocks.callAction.mockImplementationOnce(() =>
        Promise.resolve({ rows: [{ v: "b" }], schema: [] }),
      );
      await render({ sql: "A" });
      await settle();
      expect(latest.rows).toEqual([{ v: "b" }]);

      await act(async () =>
        slowForA.resolve({ rows: [{ v: "a-late" }], schema: [] }),
      );
      expect(latest.rows).toEqual([{ v: "b" }]);

      // The late answer was dropped with its cancelled query; the first
      // account asks again rather than adopting it.
      mocks.callAction.mockReset();
      answers({ A: { v: "a-fresh" } });
      mocks.session.session = userA;
      await render({ sql: "A" });
      await vi.waitFor(() => expect(latest.rows).toEqual([{ v: "a-fresh" }]));
      expect(mocks.callAction).toHaveBeenCalledTimes(1);
    });

    it.each<SessionStatus>([
      "loading",
      "unavailable",
      "unauthenticated",
      "signing-out",
    ])(
      "shows nothing and starts no query while the session is %s",
      async (status) => {
        answers({ A: { v: "a" } });
        await render({ sql: "A" });
        await settle();
        mocks.callAction.mockClear();

        mocks.session.status = status;
        mocks.session.session = status === "loading" ? userA : null;
        await render({ sql: "A" });
        await render({ sql: "B" });

        expect(latest.rows).toBeUndefined();
        expect(latest.placeholder).toBe(false);
        expect(latest.loading).toBe(true);
        expect(mocks.callAction).not.toHaveBeenCalled();
      },
    );

    it("does not retain the signed-in account's rows after the session goes away and returns", async () => {
      answers({ A: { v: "a" }, B: { v: "b" } });
      await render({ sql: "A" });
      await settle();

      mocks.session.status = "unavailable";
      mocks.session.session = null;
      await render({ sql: "A" });
      expect(latest.rows).toBeUndefined();

      mocks.callAction.mockImplementation(unanswered);
      mocks.session.status = "authenticated";
      mocks.session.session = userA;
      await render({ sql: "B" });
      expect(latest.rows).toBeUndefined();
      expect(latest.placeholder).toBe(false);
    });
  });
});
