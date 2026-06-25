// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useDbSync,
  useScreenRefreshKey,
  _resetSyncTransportRegistryForTests,
} from "./use-db-sync.js";

class QueryClientProbe {
  calls: Array<{ queryKey?: string[] } | undefined> = [];

  invalidateQueries(opts?: { queryKey?: string[] }) {
    this.calls.push(opts);
  }
}

function SyncProbe({ queryClient }: { queryClient: QueryClientProbe }) {
  useDbSync({
    queryClient,
    sseUrl: false,
    interval: 50,
    pauseWhenHidden: false,
  });
  return null;
}

let screenKeyValue = 0;
function ScreenKeyProbe() {
  const k = useScreenRefreshKey({
    sseUrl: false,
    interval: 50,
    pauseWhenHidden: false,
  });
  screenKeyValue = k;
  return null;
}

async function renderWithEvent(event: Record<string, unknown>) {
  const queryClient = new QueryClientProbe();
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ version: event.version ?? 1, events: [event] }),
      ),
  );
  vi.stubGlobal("fetch", fetchMock);

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<SyncProbe queryClient={queryClient} />);
    await Promise.resolve();
    await Promise.resolve();
  });

  return { container, fetchMock, queryClient, root };
}

describe("useDbSync", () => {
  let roots: Root[] = [];
  let containers: HTMLDivElement[] = [];

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    _resetSyncTransportRegistryForTests();
    screenKeyValue = 0;
  });

  afterEach(() => {
    for (const root of roots) {
      act(() => root.unmount());
    }
    for (const container of containers) {
      container.remove();
    }
    roots = [];
    containers = [];
    vi.unstubAllGlobals();
    vi.useRealTimers();
    _resetSyncTransportRegistryForTests();
  });

  it("broadly invalidates active queries for action events", async () => {
    const result = await renderWithEvent({
      version: 1,
      source: "action",
      type: "change",
      key: "create-project",
    });
    roots.push(result.root);
    containers.push(result.container);

    expect(result.fetchMock).toHaveBeenCalled();
    expect(result.queryClient.calls).toContainEqual(undefined);
    expect(result.queryClient.calls).toContainEqual({ queryKey: ["action"] });
  });

  it("keeps non-action events on targeted framework invalidations", async () => {
    const result = await renderWithEvent({
      version: 1,
      source: "settings",
      type: "change",
      key: "*",
    });
    roots.push(result.root);
    containers.push(result.container);

    expect(result.fetchMock).toHaveBeenCalled();
    expect(result.queryClient.calls).not.toContainEqual(undefined);
    expect(result.queryClient.calls).toContainEqual({ queryKey: ["action"] });
  });

  it("backs off polling after an auth failure", async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClientProbe();
    const fetchMock = vi.fn(
      async () =>
        new Response("Unauthorized", {
          status: 401,
          statusText: "Unauthorized",
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    containers.push(container);

    await act(async () => {
      root.render(<SyncProbe queryClient={queryClient} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores poll results that resolve after unmount", async () => {
    const queryClient = new QueryClientProbe();
    let resolvePoll:
      | ((response: Response | PromiseLike<Response>) => void)
      | null = null;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolvePoll = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<SyncProbe queryClient={queryClient} />);
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => root.unmount());

    await act(async () => {
      resolvePoll!(
        new Response(
          JSON.stringify({
            version: 1,
            events: [{ version: 1, source: "action", type: "change" }],
          }),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(queryClient.calls).toEqual([]);
    container.remove();
  });

  // -------------------------------------------------------------------------
  // Shared transport regression tests
  // -------------------------------------------------------------------------

  it("uses a single fetch when useDbSync and useScreenRefreshKey are both mounted", async () => {
    const queryClient = new QueryClientProbe();
    let callCount = 0;
    const fetchMock = vi.fn(async () => {
      callCount++;
      return new Response(
        JSON.stringify({
          version: callCount,
          events: [{ version: callCount, source: "action", type: "change" }],
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    function BothHooks() {
      useDbSync({
        queryClient,
        sseUrl: false,
        interval: 50,
        pauseWhenHidden: false,
      });
      useScreenRefreshKey({
        sseUrl: false,
        interval: 50,
        pauseWhenHidden: false,
      });
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    containers.push(container);

    await act(async () => {
      root.render(<BothHooks />);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Both hooks share the same transport — only ONE fetch call for the
    // initial poll, not two.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fans events to both useDbSync and useScreenRefreshKey subscribers", async () => {
    const queryClient = new QueryClientProbe();
    let capturedScreenKey = 0;

    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            version: 1,
            events: [
              { version: 1, source: "action", type: "change" },
              { version: 2, source: "screen-refresh" },
            ],
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    function BothHooks() {
      useDbSync({
        queryClient,
        sseUrl: false,
        interval: 50,
        pauseWhenHidden: false,
      });
      const k = useScreenRefreshKey({
        sseUrl: false,
        interval: 50,
        pauseWhenHidden: false,
      });
      capturedScreenKey = k;
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    containers.push(container);

    await act(async () => {
      root.render(<BothHooks />);
      await Promise.resolve();
      await Promise.resolve();
    });

    // useDbSync received the action event.
    expect(queryClient.calls).toContainEqual({ queryKey: ["action"] });
    // useScreenRefreshKey received the screen-refresh event.
    expect(capturedScreenKey).toBe(1);
  });

  it("creates a fresh transport after all subscribers unmount", async () => {
    let fetchCallCount = 0;
    const fetchMock = vi.fn(async () => {
      fetchCallCount++;
      return new Response(
        JSON.stringify({
          version: fetchCallCount,
          events: [{ version: fetchCallCount, source: "action" }],
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const qc1 = new QueryClientProbe();
    const container1 = document.createElement("div");
    document.body.appendChild(container1);
    const root1 = createRoot(container1);

    await act(async () => {
      root1.render(<SyncProbe queryClient={qc1} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const afterFirst = fetchCallCount;
    expect(afterFirst).toBeGreaterThanOrEqual(1);

    // Unmount — transport tears down and registry entry is cleared.
    act(() => root1.unmount());
    container1.remove();

    // Re-mount should start a fresh transport (new poll from version 0).
    fetchCallCount = 0;
    const qc2 = new QueryClientProbe();
    const container2 = document.createElement("div");
    document.body.appendChild(container2);
    const root2 = createRoot(container2);
    roots.push(root2);
    containers.push(container2);

    await act(async () => {
      root2.render(<SyncProbe queryClient={qc2} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    // New transport polls again from scratch.
    expect(fetchCallCount).toBeGreaterThanOrEqual(1);
  });
});
