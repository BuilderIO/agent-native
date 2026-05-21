// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDbSync } from "./use-db-sync.js";

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
});
