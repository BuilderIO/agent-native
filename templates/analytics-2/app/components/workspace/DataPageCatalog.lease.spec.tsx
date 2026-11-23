// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CATALOG_LEASE_WATCH_CEILING_MS,
  CATALOG_LEASE_WATCH_INTERVAL_MS,
  useCatalogLeaseWatch,
  type CatalogOutput,
} from "./DataPageCatalog";

const REACT_ACT_ENVIRONMENT = globalThis as {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
REACT_ACT_ENVIRONMENT.IS_REACT_ACT_ENVIRONMENT = true;

function catalog(
  refreshState: CatalogOutput["refreshState"],
  refreshStale: boolean,
): CatalogOutput {
  return {
    connectionId: "connection-1",
    scope: "root-schemas",
    resources: [],
    totalCount: 0,
    hasNextPage: false,
    endCursor: null,
    refreshState,
    hasSuccessfulSnapshot: false,
    bootstrapKey: "bootstrap-key-1",
    revision: "revision-1",
    lastRefreshed: null,
    refreshError: null,
    refreshProgress: null,
    refreshStale,
  };
}

function Probe({
  data,
  enabled,
  onRead,
  watchKey,
}: {
  data: CatalogOutput | undefined;
  enabled: boolean;
  onRead: () => Promise<unknown>;
  watchKey: string | undefined;
}) {
  useCatalogLeaseWatch({
    data,
    enabled,
    refetch: onRead,
    watchKey,
  });
  return null;
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
    });
    root = undefined;
  }
  container?.remove();
  container = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

async function render(next: {
  data: CatalogOutput | undefined;
  enabled: boolean;
  onRead: () => Promise<unknown>;
  watchKey: string | undefined;
}) {
  await act(async () => {
    root?.render(
      <Probe
        data={next.data}
        enabled={next.enabled}
        onRead={next.onRead}
        watchKey={next.watchKey}
      />,
    );
  });
}

describe("catalog lease watch", () => {
  it("performs bounded GET rechecks while refreshing and stops at the ceiling", async () => {
    const readCatalog = vi.fn(async () => undefined);
    await render({
      data: catalog("refreshing", false),
      enabled: true,
      onRead: readCatalog,
      watchKey: "connection-1",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CATALOG_LEASE_WATCH_INTERVAL_MS);
    });
    expect(readCatalog).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(readCatalog.mock.calls.length).toBeGreaterThan(1);
    const atCeiling = readCatalog.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(readCatalog.mock.calls.length).toBe(atCeiling);
    expect(
      (atCeiling + 1) * CATALOG_LEASE_WATCH_INTERVAL_MS,
    ).toBeGreaterThanOrEqual(CATALOG_LEASE_WATCH_CEILING_MS);
  });

  it("stops when the selection is disabled or the lease becomes stale", async () => {
    const readCatalog = vi.fn(async () => undefined);
    await render({
      data: catalog("refreshing", false),
      enabled: true,
      onRead: readCatalog,
      watchKey: "connection-1",
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CATALOG_LEASE_WATCH_INTERVAL_MS);
    });
    const afterFirst = readCatalog.mock.calls.length;

    await render({
      data: catalog("refreshing", false),
      enabled: false,
      onRead: readCatalog,
      watchKey: "connection-1",
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(readCatalog.mock.calls.length).toBe(afterFirst);

    await render({
      data: catalog("refreshing", true),
      enabled: true,
      onRead: readCatalog,
      watchKey: "connection-1",
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(readCatalog.mock.calls.length).toBe(afterFirst);
  });

  it("stops on unmount and starts a fresh watch for a new source key", async () => {
    const readCatalog = vi.fn(async () => undefined);
    await render({
      data: catalog("refreshing", false),
      enabled: true,
      onRead: readCatalog,
      watchKey: "connection-1",
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CATALOG_LEASE_WATCH_INTERVAL_MS);
    });
    const first = readCatalog.mock.calls.length;

    await render({
      data: catalog("refreshing", false),
      enabled: true,
      onRead: readCatalog,
      watchKey: "connection-2",
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CATALOG_LEASE_WATCH_INTERVAL_MS);
    });
    expect(readCatalog.mock.calls.length).toBe(first + 1);

    await act(async () => {
      root?.unmount();
    });
    root = undefined;
    const beforeUnmount = readCatalog.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(readCatalog.mock.calls.length).toBe(beforeUnmount);
  });
});

it("never overlaps read requests when a prior lease observation is pending", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const readCatalog = vi.fn(() => pending);
  try {
    await render({
      data: catalog("refreshing", false),
      enabled: true,
      onRead: readCatalog,
      watchKey: "connection-1",
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(readCatalog).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => {
      release();
      await pending;
    });
  }
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
  expect(readCatalog).toHaveBeenCalledTimes(2);
});

it("keeps watching a later active lease when the server reports actual progress", async () => {
  const readCatalog = vi.fn(async () => undefined);
  const output = {
    ...catalog("refreshing", false),
    refreshProgress: { collectedCount: 1, pages: 1 },
  };
  await render({
    data: output,
    enabled: true,
    onRead: readCatalog,
    watchKey: "connection-1",
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10 * 60_000);
  });
  const beforeProgress = readCatalog.mock.calls.length;
  await render({
    data: { ...output, refreshProgress: { collectedCount: 2, pages: 2 } },
    enabled: true,
    onRead: readCatalog,
    watchKey: "connection-1",
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(readCatalog.mock.calls.length).toBeGreaterThan(beforeProgress);
});
