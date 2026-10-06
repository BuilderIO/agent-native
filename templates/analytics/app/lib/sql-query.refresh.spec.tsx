// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addBytesProcessed: vi.fn(),
  callAction: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
}));

vi.mock("./cost-tracker", () => ({
  addBytesProcessed: mocks.addBytesProcessed,
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useSqlQuery } from "./sql-query";

function QueryProbe({
  refreshToken,
  sql,
}: {
  refreshToken: number;
  sql: string;
}) {
  const query = useSqlQuery(["sql", sql], sql, "bigquery", { refreshToken });
  return <div>{query.data ? "loaded" : "loading"}</div>;
}

describe("useSqlQuery refresh", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mocks.addBytesProcessed.mockReset();
    mocks.callAction.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
  });

  it("restarts an in-flight initial fetch as a forced refresh", async () => {
    let initialSignal: AbortSignal | undefined;
    mocks.callAction.mockImplementation((_name, args, options) => {
      if (mocks.callAction.mock.calls.length === 1) {
        initialSignal = options.signal;
        return new Promise((_resolve, reject) => {
          const abort = () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          };
          if (options.signal.aborted) {
            abort();
          } else {
            options.signal.addEventListener("abort", abort, { once: true });
          }
        });
      }
      return Promise.resolve({ rows: [{ value: 42 }], schema: [] });
    });

    const render = (sql: string, refreshToken: number) =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <QueryProbe refreshToken={refreshToken} sql={sql} />
        </QueryClientProvider>,
      );

    await act(async () => render("SELECT 1", 0));
    await vi.waitFor(() => expect(mocks.callAction).toHaveBeenCalledTimes(1));

    await act(async () => render("SELECT 1", 1));
    await vi.waitFor(() => expect(mocks.callAction).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(container.textContent).toBe("loaded"));

    expect(initialSignal?.aborted).toBe(true);
    expect(mocks.callAction.mock.calls[0]?.[1]).toEqual({
      query: "SELECT 1",
      source: "bigquery",
    });
    expect(mocks.callAction.mock.calls[1]?.[1]).toEqual({
      query: "SELECT 1",
      source: "bigquery",
      forceRefresh: true,
    });

    await act(async () => render("SELECT 2", 1));
    await vi.waitFor(() => expect(mocks.callAction).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(container.textContent).toBe("loaded"));

    expect(mocks.callAction.mock.calls[2]?.[1]).toEqual({
      query: "SELECT 2",
      source: "bigquery",
    });
  });
});
