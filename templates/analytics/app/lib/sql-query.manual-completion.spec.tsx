// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  session: { email: "a@example.com", userId: "user-a", orgId: "org-1" },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
  useSession: () => ({ session: mocks.session, status: "authenticated" }),
}));

vi.mock("./cost-tracker", () => ({
  addBytesProcessed: vi.fn(),
  recordQueryCost: vi.fn(),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  REFRESH_CONFIRMATION_MS,
  useRefreshConfirmation,
} from "@/components/dashboard/panel-freshness";

import { useSqlQuery } from "./sql-query";

function Probe({ refreshToken, sql }: { refreshToken: number; sql: string }) {
  const query = useSqlQuery(["sql", sql], sql, "bigquery", { refreshToken });
  const confirmed = useRefreshConfirmation({
    requestToken: refreshToken,
    scopeKey: sql,
    completedToken: query.completedManualRefreshToken,
  });
  return (
    <div>
      <span data-completed>{String(query.completedManualRefreshToken)}</span>
      <span data-confirmed>{String(confirmed)}</span>
    </div>
  );
}

type Call = {
  forceRefresh: boolean;
  signal: AbortSignal;
  resolve: () => void;
  reject: (error: Error) => void;
};

describe("useSqlQuery manual refresh completion", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let calls: Call[];
  // Each action call waits for the test to settle it, and ignores aborts the
  // way a response already on the wire does.
  let honorAbort: boolean;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient();
    calls = [];
    honorAbort = true;
    mocks.session = {
      email: "a@example.com",
      userId: "user-a",
      orgId: "org-1",
    };
    mocks.callAction.mockReset();
    mocks.callAction.mockImplementation(
      (_name, args, options: { signal: AbortSignal }) =>
        new Promise((resolve, reject) => {
          const call: Call = {
            forceRefresh: args.forceRefresh === true,
            signal: options.signal,
            resolve: () =>
              resolve({
                rows: [{ value: calls.length }],
                schema: [],
                fetchedAt: new Date().toISOString(),
              }),
            reject,
          };
          calls.push(call);
          if (honorAbort) {
            options.signal.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          }
        }),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const render = (refreshToken: number, sql = "SELECT 1") =>
    act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe refreshToken={refreshToken} sql={sql} />
        </QueryClientProvider>,
      );
    });
  const flush = () => act(async () => vi.advanceTimersByTimeAsync(0));
  const settle = async (index: number, outcome: "resolve" | "reject") => {
    await act(async () => {
      if (outcome === "resolve") calls[index].resolve();
      else calls[index].reject(new Error("warehouse failed"));
      await vi.advanceTimersByTimeAsync(5);
    });
  };
  const completed = () =>
    container.querySelector("[data-completed]")?.textContent;
  const confirmed = () =>
    container.querySelector("[data-confirmed]")?.textContent;
  const waitForCalls = (count: number) =>
    vi.waitFor(async () => {
      await flush();
      expect(calls.length).toBeGreaterThanOrEqual(count);
    });

  it("reports the forced fetch of the request, then drops it after the confirmation", async () => {
    await render(0);
    await waitForCalls(1);
    await settle(0, "resolve");
    expect(completed()).toBe("undefined");

    await render(1);
    await waitForCalls(2);
    expect(calls[1].forceRefresh).toBe(true);
    expect(confirmed()).toBe("false");
    await settle(1, "resolve");
    expect(completed()).toBe("1");
    expect(confirmed()).toBe("true");

    await act(async () => vi.advanceTimersByTimeAsync(REFRESH_CONFIRMATION_MS));
    expect(confirmed()).toBe("false");
  });

  it("is not confirmed by an automatic fetch that finishes while the request is cancelled", async () => {
    honorAbort = false;
    await render(0);
    await waitForCalls(1);

    // The user asks to refresh while the automatic load is still in flight.
    await render(1);
    await waitForCalls(2);
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1].forceRefresh).toBe(true);

    // The automatic one answers anyway, then the forced one fails.
    await settle(0, "resolve");
    expect(completed()).toBe("undefined");
    expect(confirmed()).toBe("false");
    await settle(1, "reject");

    expect(completed()).toBe("undefined");
    expect(confirmed()).toBe("false");
  });

  it("is not confirmed by a later fetch that reuses a failed request's cache bypass", async () => {
    await render(0);
    await waitForCalls(1);
    await settle(0, "resolve");

    await render(1);
    await waitForCalls(2);
    await settle(1, "reject");

    await act(async () => {
      void queryClient.refetchQueries({ queryKey: ["sql"] });
    });
    await waitForCalls(3);
    await settle(2, "resolve");

    expect(completed()).toBe("undefined");
    expect(confirmed()).toBe("false");
  });

  it("does not let a replaced request or its late answer confirm the second click", async () => {
    honorAbort = false;
    await render(0);
    await waitForCalls(1);
    await settle(0, "resolve");

    await render(1);
    await waitForCalls(2);
    await render(2);
    await waitForCalls(3);
    expect(calls[1].signal.aborted).toBe(true);
    expect(calls[2].forceRefresh).toBe(true);

    await settle(1, "resolve");
    expect(completed()).toBe("undefined");
    expect(confirmed()).toBe("false");

    await settle(2, "resolve");
    expect(completed()).toBe("2");
    expect(confirmed()).toBe("true");
  });

  it("never reports a token the panel mounted with, or a filter change", async () => {
    await render(5);
    await waitForCalls(1);
    expect(calls[0].forceRefresh).toBe(false);
    await settle(0, "resolve");
    expect(completed()).toBe("undefined");

    await render(5, "SELECT 2");
    await waitForCalls(2);
    expect(calls[1].forceRefresh).toBe(false);
    await settle(1, "resolve");
    expect(completed()).toBe("undefined");
    expect(confirmed()).toBe("false");
  });

  it("drops the completion when the query or the account changes", async () => {
    await render(0);
    await waitForCalls(1);
    await settle(0, "resolve");
    await render(1);
    await waitForCalls(2);
    await settle(1, "resolve");
    expect(completed()).toBe("1");

    await render(1, "SELECT 2");
    expect(completed()).toBe("undefined");
    await render(1, "SELECT 1");
    expect(completed()).toBe("undefined");

    // The abandoned second query's load was cancelled, so the forced fetch is
    // the newest call.
    await render(2);
    await waitForCalls(4);
    expect(calls[3].forceRefresh).toBe(true);
    await settle(3, "resolve");
    expect(completed()).toBe("2");

    mocks.session = {
      email: "b@example.com",
      userId: "user-b",
      orgId: "org-1",
    };
    await render(2);
    expect(completed()).toBe("undefined");
    expect(confirmed()).toBe("false");

    // Returning to the same account cannot revive the withdrawn completion.
    mocks.session = {
      email: "a@example.com",
      userId: "user-a",
      orgId: "org-1",
    };
    await render(2);
    expect(confirmed()).toBe("false");

    mocks.session = {
      email: "a@example.com",
      userId: "user-a",
      orgId: "org-2",
    };
    await render(2);
    expect(completed()).toBe("undefined");
    expect(confirmed()).toBe("false");
  });
});
