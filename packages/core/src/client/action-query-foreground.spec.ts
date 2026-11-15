// @vitest-environment jsdom
import type { Query, QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SURFACE_HIDDEN_FLAG } from "../shared/surface-visibility.js";
import {
  claimActionQueryForeground,
  invalidateForegroundActionQueries,
  observeActionQuerySurface,
} from "./action-query-foreground.js";

type FakeQuery = {
  state: { data: unknown; error: unknown; fetchFailureCount: number };
  isActive: () => boolean;
  observers: { options: { refetchIntervalInBackground?: boolean } }[];
  cancel: ReturnType<typeof vi.fn>;
  setState: ReturnType<typeof vi.fn>;
  fetch: ReturnType<typeof vi.fn>;
  fetchedForeground: boolean[];
};

function fakeQuery(
  overrides: Partial<FakeQuery["state"]> & {
    active?: boolean;
    background?: boolean;
  } = {},
): FakeQuery {
  const query: FakeQuery = {
    state: {
      data: overrides.data,
      error: overrides.error ?? null,
      fetchFailureCount: overrides.fetchFailureCount ?? 0,
    },
    isActive: () => overrides.active ?? true,
    observers: [
      { options: { refetchIntervalInBackground: overrides.background } },
    ],
    cancel: vi.fn(async () => {}),
    setState: vi.fn(),
    fetch: vi.fn(),
    fetchedForeground: [],
  };
  query.fetch.mockImplementation(() => {
    query.fetchedForeground.push(claimActionQueryForeground(asQuery(query)));
    return Promise.resolve();
  });
  return query;
}

function asQuery(query: FakeQuery): Query<unknown> {
  return query as unknown as Query<unknown>;
}

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("claimActionQueryForeground", () => {
  it("has no foreground without a query", () => {
    expect(claimActionQueryForeground(undefined)).toBe(false);
  });

  it("grants the first claim of an active, empty, untried query once", () => {
    const query = asQuery(fakeQuery());
    expect(claimActionQueryForeground(query)).toBe(true);
    expect(claimActionQueryForeground(query)).toBe(false);
  });

  it.each([
    ["inactive", { active: false }],
    ["holding data", { data: { rows: [] } }],
    ["holding an error", { error: new Error("boom") }],
    ["after a failed fetch", { fetchFailureCount: 1 }],
  ])("refuses a query %s", (_label, overrides) => {
    expect(claimActionQueryForeground(asQuery(fakeQuery(overrides)))).toBe(
      false,
    );
  });
});

describe("invalidateForegroundActionQueries", () => {
  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>)[SURFACE_HIDDEN_FLAG];
    setVisibility("visible");
  });

  function clientFor(queries: FakeQuery[]) {
    const claims: boolean[] = [];
    const findAll = vi.fn(() => queries);
    const invalidateQueries = vi.fn(() => {
      for (const query of queries)
        claims.push(claimActionQueryForeground(asQuery(query)));
      return Promise.resolve();
    });
    const client = {
      getQueryCache: () => ({ findAll }),
      invalidateQueries,
    } as unknown as QueryClient;
    return { client, claims, findAll, invalidateQueries };
  }

  it("lends foreground to the invalidated queries only while they refetch", async () => {
    const query = fakeQuery({ data: "stale" });
    const { client, claims, invalidateQueries } = clientFor([query]);
    const filters = { queryKey: ["action", "list"] };
    await invalidateForegroundActionQueries(client, filters, true);
    expect(invalidateQueries).toHaveBeenCalledWith(filters);
    expect(claims).toEqual([true]);
    expect(claimActionQueryForeground(asQuery(query))).toBe(false);
  });

  it("invalidates without foreground when the caller is in the background", async () => {
    const query = fakeQuery({ data: "stale" });
    const { client, claims, findAll } = clientFor([query]);
    await invalidateForegroundActionQueries(client, {}, false);
    expect(claims).toEqual([false]);
    expect(findAll).not.toHaveBeenCalled();
  });

  it("invalidates without foreground while the surface is hidden", async () => {
    setVisibility("hidden");
    const query = fakeQuery({ data: "stale" });
    const { client, claims, findAll } = clientFor([query]);
    await invalidateForegroundActionQueries(client, {}, true);
    expect(claims).toEqual([false]);
    expect(findAll).not.toHaveBeenCalled();
  });
});

describe("observeActionQuerySurface", () => {
  const cleanups: (() => void)[] = [];

  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>)[SURFACE_HIDDEN_FLAG];
    setVisibility("visible");
  });
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
  });

  function observe(
    query: FakeQuery | undefined,
    options: {
      foreground?: boolean;
      explicitFocus?: boolean;
      refresh?: boolean;
    } = {},
  ) {
    const stop = observeActionQuerySurface(
      () => (query ? asQuery(query) : undefined),
      () => options.refresh ?? true,
      options.foreground ?? false,
      () => options.explicitFocus ?? false,
    );
    cleanups.push(stop);
    return stop;
  }

  it("cancels and re-times a query when the surface hides, without refetching", () => {
    const query = fakeQuery({ data: "x" });
    observe(query, { foreground: true });
    setVisibility("hidden");
    expect(query.cancel).toHaveBeenCalledWith({ revert: true });
    expect(query.setState).toHaveBeenCalledWith({});
    expect(query.fetch).not.toHaveBeenCalled();
  });

  it("keeps background-polling queries running while hidden", () => {
    const query = fakeQuery({ data: "x", background: true });
    observe(query);
    setVisibility("hidden");
    expect(query.cancel).not.toHaveBeenCalled();
    expect(query.setState).toHaveBeenCalledTimes(1);
  });

  it("refetches once per query on return, giving foreground to the explicit-focus reader", () => {
    const query = fakeQuery({ data: "x" });
    observe(query, { foreground: true });
    observe(query, { foreground: true, explicitFocus: true });
    observe(query);
    setVisibility("hidden");
    setVisibility("visible");
    expect(query.fetch).toHaveBeenCalledTimes(1);
    expect(query.fetch).toHaveBeenCalledWith(undefined, {
      cancelRefetch: false,
    });
    expect(query.fetchedForeground).toEqual([true]);
    expect(claimActionQueryForeground(asQuery(query))).toBe(false);
  });

  it("spends the single foreground allowance on the explicit-focus query", () => {
    const settings = fakeQuery({ data: "settings" });
    const focused = fakeQuery({ data: "focused" });
    const plain = fakeQuery({ data: "plain" });
    observe(settings, { foreground: true });
    observe(focused, { foreground: true, explicitFocus: true });
    observe(plain);
    setVisibility("hidden");
    setVisibility("visible");
    expect(settings.fetchedForeground).toEqual([false]);
    expect(focused.fetchedForeground).toEqual([true]);
    expect(plain.fetchedForeground).toEqual([false]);
  });

  it("falls back to a foreground reader, then to any eligible reader", () => {
    const foregroundQuery = fakeQuery({ data: "a" });
    observe(foregroundQuery, { refresh: false, foreground: true });
    observe(foregroundQuery);
    observe(foregroundQuery, { foreground: true });
    const backgroundQuery = fakeQuery({ data: "b" });
    observe(backgroundQuery);
    setVisibility("hidden");
    setVisibility("visible");
    expect(foregroundQuery.fetchedForeground).toEqual([true]);
    expect(backgroundQuery.fetchedForeground).toEqual([false]);
  });

  it("skips queries nobody wants refreshed and observers with no query", () => {
    const query = fakeQuery({ data: "x" });
    observe(query, { refresh: false, foreground: true });
    observe(undefined, { foreground: true });
    setVisibility("hidden");
    setVisibility("visible");
    expect(query.fetch).not.toHaveBeenCalled();
  });

  it("ignores a visibility event that does not change the surface's visibility", () => {
    const query = fakeQuery({ data: "x" });
    observe(query, { foreground: true });
    setVisibility("visible");
    expect(query.setState).not.toHaveBeenCalled();
    expect(query.fetch).not.toHaveBeenCalled();
  });

  it("refreshes stale reads when the window regains focus while the tab stayed visible", () => {
    const stale = fakeQuery({ data: "stale" });
    const fresh = fakeQuery({ data: "fresh" });
    observe(stale, { foreground: true });
    observe(fresh, { refresh: false });
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    expect(stale.fetch).toHaveBeenCalledTimes(1);
    expect(stale.fetch).toHaveBeenCalledWith(undefined, {
      cancelRefetch: false,
    });
    expect(stale.cancel).not.toHaveBeenCalled();
    expect(fresh.fetch).not.toHaveBeenCalled();
    // One return, one refresh: a repeated focus without a new blur is not one.
    window.dispatchEvent(new Event("focus"));
    expect(stale.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not count the focus that follows a visibility return as a second return", () => {
    const query = fakeQuery({ data: "x" });
    observe(query, { foreground: true });
    window.dispatchEvent(new Event("blur"));
    setVisibility("hidden");
    setVisibility("visible");
    window.dispatchEvent(new Event("focus"));
    expect(query.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not refresh on window focus while the surface is hidden", () => {
    const query = fakeQuery({ data: "x" });
    observe(query, { foreground: true });
    (window as unknown as Record<string, unknown>)[SURFACE_HIDDEN_FLAG] = true;
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    expect(query.fetch).not.toHaveBeenCalled();
  });

  it("treats a host-hidden surface like a hidden document, and window focus as a return", () => {
    const query = fakeQuery({ data: "x" });
    observe(query, { foreground: true });
    (window as unknown as Record<string, unknown>)[SURFACE_HIDDEN_FLAG] = true;
    window.dispatchEvent(new Event("focus"));
    expect(query.cancel).toHaveBeenCalledTimes(1);
    delete (window as unknown as Record<string, unknown>)[SURFACE_HIDDEN_FLAG];
    window.dispatchEvent(new Event("focus"));
    expect(query.fetchedForeground).toEqual([true]);
  });

  it("stops listening once the last observer unsubscribes", () => {
    const query = fakeQuery({ data: "x" });
    const first = observe(query);
    const second = observe(query);
    first();
    setVisibility("hidden");
    expect(query.setState).toHaveBeenCalledTimes(1);
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    const removeDocumentListener = vi.spyOn(document, "removeEventListener");
    try {
      second();
      expect(removeWindowListener).toHaveBeenCalledWith(
        "focus",
        expect.any(Function),
      );
      expect(removeDocumentListener).toHaveBeenCalledWith(
        "visibilitychange",
        expect.any(Function),
      );
    } finally {
      removeWindowListener.mockRestore();
      removeDocumentListener.mockRestore();
    }
    setVisibility("visible");
    setVisibility("hidden");
    expect(query.setState).toHaveBeenCalledTimes(1);
  });

  it("starts from the current visibility when the first observer mounts hidden", () => {
    setVisibility("hidden");
    const query = fakeQuery({ data: "x" });
    observe(query);
    setVisibility("hidden");
    expect(query.setState).not.toHaveBeenCalled();
    setVisibility("visible");
    expect(query.fetch).toHaveBeenCalledTimes(1);
  });
});
