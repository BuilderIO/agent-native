import { describe, expect, it, vi } from "vitest";

import type { DatasetPage } from "@/components/data/model";

import {
  CatalogBootstrapController,
  CatalogUnavailableError,
  catalogBootstrapKey,
  catalogHasSuccessfulSnapshot,
  catalogPageFromOutput,
  catalogRevision,
  catalogRevisionKey,
  catalogRootEnabled,
  RootResetBudget,
  catalogViewState,
  connectionRefreshPending,
  getSharedCatalogBootstrapController,
  isKnownCatalogCursorRestart,
  isStaleCatalogCursorError,
  rootReaderRevision,
  shouldBootstrapCatalog,
  shouldBootstrapCatalogWithKey,
  shouldCoordinateCatalogResult,
  settleRefetch,
  loadDatasetPage,
  nextRevisionSync,
  nextStaleCursorRestart,
  readCatalogRevision,
  staleCursorRestartForSelected,
  withConnectionRefreshPending,
  type CatalogOutput,
} from "./DataPageCatalog";

function resources(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `schema:project-1:dataset-${index + 1}`,
    name: `dataset_${index + 1}`,
    kind: "schema" as const,
    hasChildren: true,
  }));
}

function catalog(overrides: Partial<CatalogOutput> = {}): CatalogOutput {
  const base: CatalogOutput = {
    connectionId: "connection-1",
    scope: "root-schemas",
    resources: [],
    totalCount: 0,
    hasNextPage: false,
    endCursor: null,
    refreshState: "ready",
    hasSuccessfulSnapshot: true,
    bootstrapKey: "bootstrap-key-1",
    revision: "revision-1",
    lastRefreshed: "2026-01-01T00:00:00.000Z",
    refreshError: null,
    refreshProgress: null,
    refreshStale: false,
    ...overrides,
  };
  return { ...base, ...overrides };
}

const emptyPage: DatasetPage = {
  items: [],
  endCursor: null,
  hasNextPage: false,
};

describe("saved root catalog contract", () => {
  it("maps resources and keeps the whole matching total, not the page length", () => {
    const output = catalog({
      resources: resources(10),
      totalCount: 62,
      hasNextPage: true,
      endCursor: "cursor-10",
    });
    const page = catalogPageFromOutput(output);
    expect(page.items).toHaveLength(10);
    expect(page.totalCount).toBe(62);
    expect(page.hasNextPage).toBe(true);
    expect(page.endCursor).toBe("cursor-10");
  });

  it("treats a legitimate empty ready snapshot as successful", () => {
    const output = catalog({ resources: [], totalCount: 0 });
    expect(catalogHasSuccessfulSnapshot(output)).toBe(true);
    expect(catalogViewState(output)).toBe("ready");
  });

  it("does not treat a failed first cache as a successful empty cache", () => {
    const output = catalog({
      refreshState: "failed",
      lastRefreshed: null,
      refreshError: { code: "refresh_failed", message: "Refresh failed" },
      hasSuccessfulSnapshot: false,
    });
    expect(catalogHasSuccessfulSnapshot(output)).toBe(false);
    expect(catalogViewState(output)).toBe("blocked");
  });

  it("keeps a last-good snapshot readable under failed/refreshing state", () => {
    const failed = catalog({
      refreshState: "failed",
      hasSuccessfulSnapshot: true,
      resources: resources(62),
      totalCount: 62,
    });
    expect(catalogViewState(failed)).toBe("last-good");
    const refreshing = catalog({
      refreshState: "refreshing",
      hasSuccessfulSnapshot: true,
    });
    expect(catalogViewState(refreshing)).toBe("last-good");
  });

  it("keeps a stale but readable snapshot visible before its refresh starts", () => {
    expect(
      catalogViewState(
        catalog({ refreshState: "stale", hasSuccessfulSnapshot: true }),
      ),
    ).toBe("last-good");
    expect(
      catalogViewState(
        catalog({ refreshState: "stale", hasSuccessfulSnapshot: false }),
      ),
    ).toBe("stale");
  });

  it("uses the published revision when present and a stable fallback otherwise", () => {
    expect(catalogRevision(catalog({ revision: "rev-2" }))).toBe("rev-2");
    expect(readCatalogRevision(catalog({ revision: null }))).toBeNull();
    expect(
      catalogRevision(
        catalog({ connectionId: "c1", revision: null, lastRefreshed: "t1" }),
      ),
    ).toBe("c1:ready:t1");
  });
});

describe("missing-cache bootstrap policy", () => {
  it("bootstraps a genuine never cache only for an eligible manager", () => {
    const never = catalog({
      refreshState: "never",
      hasSuccessfulSnapshot: false,
      lastRefreshed: null,
      resources: [],
      totalCount: 0,
    });
    expect(shouldBootstrapCatalog(never, true)).toBe(true);
    expect(shouldBootstrapCatalog(never, false)).toBe(false);
  });

  it("does not bootstrap a ready, last-good, failed or stale cache", () => {
    expect(shouldBootstrapCatalog(catalog(), true)).toBe(false);
    expect(
      shouldBootstrapCatalog(
        catalog({ refreshState: "failed", hasSuccessfulSnapshot: true }),
        true,
      ),
    ).toBe(false);
    expect(
      shouldBootstrapCatalog(
        catalog({ refreshState: "failed", hasSuccessfulSnapshot: false }),
        true,
      ),
    ).toBe(false);
    expect(
      shouldBootstrapCatalog(
        catalog({ refreshState: "stale", hasSuccessfulSnapshot: true }),
        true,
      ),
    ).toBe(false);
  });
});

describe("root reader revision", () => {
  it("keeps both readers stable on a same-source failure", () => {
    const ready = catalog({
      revision: "rev-1",
      resources: resources(62),
      totalCount: 62,
    });
    const failed = catalog({
      revision: "rev-1",
      refreshState: "failed",
      hasSuccessfulSnapshot: true,
      resources: resources(62),
      totalCount: 62,
    });
    expect(rootReaderRevision(ready, 0)).toBe(rootReaderRevision(failed, 0));
  });

  it("changes the shared token after a confirmed replacement, stale source or explicit restart", () => {
    const original = catalog({ revision: "rev-1" });
    const replacement = catalog({
      revision: "rev-2",
      lastRefreshed: "2026-01-02T00:00:00.000Z",
    });
    const stale = catalog({
      revision: "rev-1",
      refreshState: "stale",
      hasSuccessfulSnapshot: false,
    });
    const retained = catalog({ revision: "rev-1", refreshState: "stale" });
    expect(rootReaderRevision(original, 0)).not.toBe(
      rootReaderRevision(replacement, 0),
    );
    expect(rootReaderRevision(original, 0)).not.toBe(
      rootReaderRevision(stale, 0),
    );
    expect(rootReaderRevision(original, 0)).toBe(
      rootReaderRevision(retained, 0),
    );
    expect(rootReaderRevision(original, 0)).not.toBe(
      rootReaderRevision(original, 1),
    );
  });
});

describe("saved root catalog dispatch", () => {
  it("reads ready rows/count from the catalog without a provider call", async () => {
    const output = catalog({
      resources: resources(62),
      totalCount: 62,
      hasNextPage: false,
    });
    const catalogRead = vi.fn(async () => output);
    const providerRead = vi.fn(async () => emptyPage);
    const page = await loadDatasetPage(
      { connectionId: "connection-1", first: 150 },
      { catalog: catalogRead, provider: providerRead },
    );
    expect(page.items).toHaveLength(62);
    expect(page.totalCount).toBe(62);
    expect(catalogRead).toHaveBeenCalledTimes(1);
    expect(providerRead).not.toHaveBeenCalled();
  });

  it("keeps last-good rows while a same-source refresh has failed", async () => {
    const output = catalog({
      refreshState: "failed",
      hasSuccessfulSnapshot: true,
      resources: resources(62),
      totalCount: 62,
      refreshError: { code: "refresh_failed", message: "Refresh failed" },
    });
    const page = await loadDatasetPage(
      { connectionId: "connection-1", first: 150 },
      { catalog: async () => output, provider: async () => emptyPage },
    );
    expect(page.items).toHaveLength(62);
    expect(page.totalCount).toBe(62);
  });

  it("throws an honest unavailable error for a failed first cache and never falls back", async () => {
    const providerRead = vi.fn(async () => emptyPage);
    const read = loadDatasetPage(
      { connectionId: "connection-1", first: 150 },
      {
        catalog: async () =>
          catalog({
            refreshState: "failed",
            hasSuccessfulSnapshot: false,
            lastRefreshed: null,
            resources: [],
            totalCount: 0,
          }),
        provider: providerRead,
      },
    );
    await expect(read).rejects.toBeInstanceOf(CatalogUnavailableError);
    expect(providerRead).not.toHaveBeenCalled();
  });

  it("throws for a stale source and never mixes old rows", async () => {
    const providerRead = vi.fn(async () => emptyPage);
    await expect(
      loadDatasetPage(
        { connectionId: "connection-1", first: 150 },
        {
          catalog: async () =>
            catalog({ refreshState: "stale", hasSuccessfulSnapshot: false }),
          provider: providerRead,
        },
      ),
    ).rejects.toBeInstanceOf(CatalogUnavailableError);
    expect(providerRead).not.toHaveBeenCalled();
  });

  it("passes first/search and the catalog opaque cursor to the catalog request", async () => {
    const catalogRead = vi.fn(async () => catalog());
    await loadDatasetPage(
      {
        connectionId: "connection-1",
        first: 150,
        search: "orders",
        after: "opaque-catalog-cursor",
      },
      { catalog: catalogRead, provider: async () => emptyPage },
    );
    expect(catalogRead).toHaveBeenCalledWith({
      connectionId: "connection-1",
      first: 150,
      search: "orders",
      after: "opaque-catalog-cursor",
    });
  });

  it("dispatches child reads to the provider only", async () => {
    const providerRead = vi.fn(async () => ({
      items: [
        {
          id: "table:project-1:dataset-1:orders",
          name: "orders",
          kind: "table" as const,
          hasChildren: false,
        },
      ],
      endCursor: null,
      hasNextPage: false,
    }));
    const catalogRead = vi.fn(async () => catalog());
    const page = await loadDatasetPage(
      {
        connectionId: "connection-1",
        parentId: "schema:project-1:dataset-1",
        first: 50,
      },
      { catalog: catalogRead, provider: providerRead },
    );
    expect(page.items[0]?.name).toBe("orders");
    expect(providerRead).toHaveBeenCalledTimes(1);
    expect(catalogRead).not.toHaveBeenCalled();
  });

  it("propagates a catalog read error without a provider fallback", async () => {
    const providerRead = vi.fn(async () => emptyPage);
    const failure = new Error("catalog denied");
    await expect(
      loadDatasetPage(
        { connectionId: "connection-1", first: 150 },
        {
          catalog: async () => Promise.reject(failure),
          provider: providerRead,
        },
      ),
    ).rejects.toBe(failure);
    expect(providerRead).not.toHaveBeenCalled();
  });
});

describe("stale cursor restart", () => {
  it("recognizes a 409 or a stale/cursor code only", () => {
    expect(isStaleCatalogCursorError({ status: 409 })).toBe(true);
    expect(isStaleCatalogCursorError({ statusCode: 409 })).toBe(true);
    expect(
      isStaleCatalogCursorError({ code: "data_catalog_stale_cursor" }),
    ).toBe(true);
    expect(isStaleCatalogCursorError({ status: 403 })).toBe(false);
    expect(isStaleCatalogCursorError(new Error("other failure"))).toBe(false);
    expect(isStaleCatalogCursorError(null)).toBe(false);
  });

  it("restarts a bounded number of times for the same search", () => {
    let state = { key: "", count: 0 };
    const first = nextStaleCursorRestart(state, "c1:orders");
    expect(first.restart).toBe(true);
    state = first.state;
    const second = nextStaleCursorRestart(state, "c1:orders");
    expect(second.restart).toBe(true);
    state = second.state;
    const third = nextStaleCursorRestart(state, "c1:orders");
    expect(third.restart).toBe(false);
    const otherSearch = nextStaleCursorRestart(third.state, "c1:events");
    expect(otherSearch.restart).toBe(true);
  });
});

describe("missing-cache bootstrap controller", () => {
  it("runs one coalesced bootstrap for two concurrent callers", async () => {
    const controller = new CatalogBootstrapController();
    let resolveRun: (() => void) | undefined;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRun = resolve;
        }),
    );
    const first = controller.ensure("connection-1", true, run);
    const second = controller.ensure("connection-1", true, run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    resolveRun?.();
    await first;
    expect(controller.isRunning("connection-1")).toBe(false);
  });

  it("does not run for an ineligible viewer", () => {
    const controller = new CatalogBootstrapController();
    const run = vi.fn(async () => {});
    expect(controller.ensure("connection-1", false, run)).toBeUndefined();
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps an in-flight bootstrap for one connection out of another connection", async () => {
    const controller = new CatalogBootstrapController();
    let resolveA: (() => void) | undefined;
    const runA = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveA = resolve;
        }),
    );
    const runB = vi.fn(async () => {});
    const first = controller.ensure("connection-a", true, runA);
    const second = controller.ensure("connection-b", true, runB);
    expect(runA).toHaveBeenCalledTimes(1);
    expect(runB).toHaveBeenCalledTimes(1);
    resolveA?.();
    await first;
    await second;
    expect(controller.isRunning("connection-a")).toBe(false);
    expect(controller.isRunning("connection-b")).toBe(false);
  });

  it("does not auto retry after the first attempt settles", async () => {
    const controller = new CatalogBootstrapController();
    const run = vi.fn(async () => {
      throw new Error("refresh failed");
    });
    await expect(controller.ensure("connection-1", true, run)).rejects.toThrow(
      "refresh failed",
    );
    expect(controller.hasAttempted("connection-1")).toBe(true);
    expect(controller.ensure("connection-1", true, run)).toBeUndefined();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("bootstrap-key policy", () => {
  it("reads only a non-empty server bootstrap key", () => {
    expect(catalogBootstrapKey(catalog())).toBe("bootstrap-key-1");
    expect(catalogBootstrapKey(catalog({ bootstrapKey: "" }))).toBeUndefined();
  });

  it("requires a published key before any automatic bootstrap", () => {
    const never = catalog({
      refreshState: "never",
      hasSuccessfulSnapshot: false,
      lastRefreshed: null,
      resources: [],
      totalCount: 0,
    });
    expect(shouldBootstrapCatalogWithKey(never, true, undefined)).toBe(false);
    expect(shouldBootstrapCatalogWithKey(never, true, "key-1")).toBe(true);
    expect(shouldBootstrapCatalogWithKey(never, false, "key-1")).toBe(false);
    expect(shouldBootstrapCatalogWithKey(catalog(), true, "key-1")).toBe(false);
    expect(
      shouldBootstrapCatalogWithKey(
        catalog({ refreshState: "stale", hasSuccessfulSnapshot: true }),
        true,
        "key-1",
      ),
    ).toBe(false);
  });

  it("keeps the legacy two-argument predicate for the older expectations", () => {
    const never = catalog({
      refreshState: "never",
      hasSuccessfulSnapshot: false,
      lastRefreshed: null,
    });
    expect(shouldBootstrapCatalog(never, true)).toBe(true);
  });
});

describe("catalog root gate", () => {
  const blocked = {
    hasOutput: true,
    state: "blocked" as const,
    initializing: false,
    bootstrapGateOpen: false,
    refreshPending: false,
    remoteRefreshing: false,
    fetching: false,
    queryError: false,
  };

  it("keeps a blocked root in loading while remote or local work is pending", () => {
    expect(catalogRootEnabled({ ...blocked, remoteRefreshing: true })).toBe(
      false,
    );
    expect(catalogRootEnabled({ ...blocked, refreshPending: true })).toBe(
      false,
    );
    expect(catalogRootEnabled({ ...blocked, initializing: true })).toBe(false);
    expect(catalogRootEnabled({ ...blocked, bootstrapGateOpen: true })).toBe(
      false,
    );
    expect(catalogRootEnabled({ ...blocked, fetching: true })).toBe(false);
  });

  it("enables a settled blocked root and all last-good states", () => {
    expect(catalogRootEnabled(blocked)).toBe(true);
    expect(
      catalogRootEnabled({
        ...blocked,
        state: "last-good",
        remoteRefreshing: true,
      }),
    ).toBe(true);
    expect(
      catalogRootEnabled({ ...blocked, state: "ready", fetching: true }),
    ).toBe(true);
  });

  it("loads while the initial query is pending and enables a read retry on error", () => {
    expect(
      catalogRootEnabled({ ...blocked, hasOutput: false, state: "loading" }),
    ).toBe(false);
    expect(
      catalogRootEnabled({
        ...blocked,
        hasOutput: false,
        state: "error",
        queryError: true,
      }),
    ).toBe(true);
  });
});

describe("connection-scoped pending and stale restart", () => {
  it("does not mark B pending from A's refresh", () => {
    const pending = withConnectionRefreshPending(new Map(), "connection-a", 1);
    expect(connectionRefreshPending(pending, "connection-a")).toBe(true);
    expect(connectionRefreshPending(pending, "connection-b")).toBe(false);
    expect(connectionRefreshPending(pending, undefined)).toBe(false);
    const cleared = withConnectionRefreshPending(pending, "connection-a", -1);
    expect(connectionRefreshPending(cleared, "connection-a")).toBe(false);
  });

  it("supports two overlapping refreshes on one connection", () => {
    let pending = withConnectionRefreshPending(new Map(), "connection-a", 1);
    pending = withConnectionRefreshPending(pending, "connection-a", 1);
    pending = withConnectionRefreshPending(pending, "connection-a", -1);
    expect(connectionRefreshPending(pending, "connection-a")).toBe(true);
    pending = withConnectionRefreshPending(pending, "connection-a", -1);
    expect(connectionRefreshPending(pending, "connection-a")).toBe(false);
  });

  it("ignores a late A stale cursor while B is selected", () => {
    const state = { key: "", count: 0 };
    expect(
      staleCursorRestartForSelected(
        "connection-b",
        "connection-a",
        state,
        "connection-a:orders",
      ),
    ).toBeUndefined();
    const decision = staleCursorRestartForSelected(
      "connection-a",
      "connection-a",
      state,
      "connection-a:orders",
    );
    expect(decision?.restart).toBe(true);
  });
});

describe("shared bootstrap controller across route mounts", () => {
  it("returns the same module-scoped controller instance", () => {
    expect(getSharedCatalogBootstrapController()).toBe(
      getSharedCatalogBootstrapController(),
    );
  });

  it("coalesces one route-mount retry and never auto-retries the key", async () => {
    const controller = getSharedCatalogBootstrapController();
    controller.reset();
    const key = `review-shared-${Math.random().toString(36).slice(2)}`;
    const run = vi.fn(async () => {});
    await controller.ensure(key, true, run);
    expect(controller.hasAttempted(key)).toBe(true);
    expect(controller.ensure(key, true, run)).toBeUndefined();
    expect(run).toHaveBeenCalledTimes(1);
    controller.reset();
  });
});

describe("refresh completion refetch", () => {
  it("settles a rejecting refetch without an unhandled rejection", async () => {
    await expect(
      settleRefetch(async () => {
        throw new Error("catalog read failed");
      }),
    ).resolves.toBe(false);
    await expect(settleRefetch(async () => {})).resolves.toBe(true);
  });
});

describe("root/controller revision coordination", () => {
  it("only compares a page and controller output for the same connection", () => {
    const controller = catalog({
      connectionId: "connection-1",
      revision: "rev-1",
    });
    expect(
      catalogRevisionKey(
        catalog({ connectionId: "connection-1", revision: "rev-2" }),
        controller,
      ),
    ).toBe("connection-1:rev-2:rev-1");
    expect(
      catalogRevisionKey(
        catalog({ connectionId: "connection-1", revision: "rev-1" }),
        controller,
      ),
    ).toBeUndefined();
    expect(
      catalogRevisionKey(
        catalog({ connectionId: "connection-2", revision: "rev-2" }),
        controller,
      ),
    ).toBeUndefined();
  });

  it("coordinates one reset/refetch per observed mismatch key and does not loop", () => {
    let state = { key: "", count: 0 };
    const first = nextRevisionSync(state, "connection-1:rev-2:rev-1");
    expect(first.sync).toBe(true);
    state = first.state;
    const repeat = nextRevisionSync(state, "connection-1:rev-2:rev-1");
    expect(repeat.sync).toBe(false);
    state = repeat.state;
    const changed = nextRevisionSync(state, "connection-1:rev-3:rev-1");
    expect(changed.sync).toBe(true);
  });
});

describe("known catalog cursor restart and result coordination", () => {
  it("only accepts the known stale-cursor code, not every 409", () => {
    expect(
      isKnownCatalogCursorRestart({
        errorCode: "data_catalog_cursor_stale",
      }),
    ).toBe(true);
    expect(
      isKnownCatalogCursorRestart({ code: "data_catalog_cursor_stale" }),
    ).toBe(true);
    expect(
      isKnownCatalogCursorRestart({
        status: 409,
        errorCode: "data_catalog_snapshot_corrupt",
      }),
    ).toBe(false);
    expect(isKnownCatalogCursorRestart({ status: 409 })).toBe(false);
    expect(isKnownCatalogCursorRestart({ status: 403 })).toBe(false);
  });

  it("ignores aborted and late non-selected results", () => {
    expect(
      shouldCoordinateCatalogResult({
        signalAborted: false,
        requestConnectionId: "connection-1",
        selectedConnectionId: "connection-1",
      }),
    ).toBe(true);
    expect(
      shouldCoordinateCatalogResult({
        signalAborted: true,
        requestConnectionId: "connection-1",
        selectedConnectionId: "connection-1",
      }),
    ).toBe(false);
    expect(
      shouldCoordinateCatalogResult({
        signalAborted: false,
        requestConnectionId: "connection-a",
        selectedConnectionId: "connection-b",
      }),
    ).toBe(false);
  });
});

describe("source-operation reset budget", () => {
  it("bounds alternating stale keys instead of resetting per key", () => {
    const budget = new RootResetBudget(2, 2);
    budget.setIdentity("connection-1:bootstrap-key");
    expect(budget.allowStale("connection-1:left")).toBe(true);
    expect(budget.allowStale("connection-1:right")).toBe(true);
    expect(budget.allowStale("connection-1:left")).toBe(false);
    expect(budget.allowStale("connection-1:third")).toBe(false);
    expect(budget.staleExhausted).toBe(true);
  });

  it("bounds alternating revision pairs and keeps counts across other-reader answers", () => {
    const budget = new RootResetBudget(2, 2);
    budget.setIdentity("connection-1:bootstrap-key");
    expect(budget.allowRevision("connection-1:rev-2:rev-1")).toBe(true);
    expect(budget.allowRevision("connection-1:rev-3:rev-1")).toBe(true);
    expect(budget.allowRevision("connection-1:rev-2:rev-1")).toBe(false);
    expect(budget.allowRevision("connection-1:rev-4:rev-1")).toBe(false);
    expect(budget.revisionExhausted).toBe(true);
  });

  it("resets only for a new identity or an explicit operation", () => {
    const budget = new RootResetBudget(2, 2);
    budget.setIdentity("connection-1:key-1");
    expect(budget.allowStale("a")).toBe(true);
    expect(budget.allowStale("b")).toBe(true);
    expect(budget.allowStale("c")).toBe(false);
    budget.setIdentity("connection-1:key-2");
    expect(budget.allowStale("a")).toBe(true);
    budget.reset();
    expect(budget.allowStale("c")).toBe(true);
  });
});
