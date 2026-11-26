// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useAsyncOptions } from "./async-options.js";

afterEach(cleanup);

it("keeps only the latest results when a provider completes after cancellation", async () => {
  const first = Promise.withResolvers<string[]>();
  const second = Promise.withResolvers<string[]>();
  const third = Promise.withResolvers<string[]>();
  const requests = [first, second, third];
  const signals: AbortSignal[] = [];
  const view = renderHook(() =>
    useAsyncOptions((_query, signal) => {
      signals.push(signal);
      const next = requests.shift();
      if (!next) throw new Error("Unexpected query");
      return next.promise;
    }),
  );
  act(() => {
    void view.result.current.search("first");
  });
  act(() => {
    void view.result.current.search("second");
  });
  expect(signals[0]?.aborted).toBe(true);
  await act(async () => {
    second.resolve(["current"]);
  });
  await act(async () => {
    first.resolve(["stale"]);
  });
  expect(view.result.current).toMatchObject({
    status: "ready",
    results: ["current"],
  });
  act(() => {
    void view.result.current.search("another");
  });
  view.unmount();
  expect(signals.at(-1)?.aborted).toBe(true);
  third.resolve([]);
});

it("keeps a cleared field idle when its cancelled request rejects later", async () => {
  const request = Promise.withResolvers<string[]>();
  const view = renderHook(() => useAsyncOptions(() => request.promise));
  act(() => {
    void view.result.current.search("pending");
  });
  await act(() => view.result.current.search(""));
  await act(async () => {
    request.reject(new Error("Connection closed"));
  });
  expect(view.result.current).toMatchObject({ status: "idle", results: [] });
});

it("distinguishes failed, empty and cleared searches", async () => {
  const view = renderHook(() =>
    useAsyncOptions(async (query) => {
      if (query === "failure") throw new Error("Search unavailable");
      return [];
    }),
  );
  for (const [query, status] of [
    ["failure", "error"],
    ["unmatched", "ready"],
    [" ", "idle"],
  ] as const) {
    await act(() => view.result.current.search(query));
    expect(view.result.current).toMatchObject({ status, results: [] });
  }
});

it("coalesces rapid edits and cancels queued work when the field clears", async () => {
  vi.useFakeTimers();
  try {
    const load = vi.fn(async (query: string) => [query]);
    const view = renderHook(() => useAsyncOptions(load, 150));
    act(() => {
      void view.result.current.search("T");
      void view.result.current.search("To");
      void view.result.current.search("Tokyo");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(149);
    });
    expect(load).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(load.mock.calls).toHaveLength(1);
    expect(view.result.current.results).toEqual(["Tokyo"]);
    act(() => {
      void view.result.current.search("L");
      void view.result.current.search("");
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(load.mock.calls).toHaveLength(1);
    expect(view.result.current).toMatchObject({ status: "idle", results: [] });
  } finally {
    vi.useRealTimers();
  }
});
