// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useActionQuery } from "./use-action.js";
import { useDbSync } from "./use-db-sync.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function jsonActionResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("window agent-native:tool-done in-place action query refetch", () => {
  const roots: Root[] = [];
  const containers: HTMLElement[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => root.unmount());
    }
    for (const container of containers.splice(0)) {
      container.remove();
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function mount() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    containers.push(container);
    return { container, root };
  }

  it("refetches active useActionQuery queries in place even when useDbSync is not mounted", async () => {
    let fetchCount = 0;
    const fetchMock = vi.fn(async () => {
      fetchCount += 1;
      return jsonActionResponse({ version: fetchCount });
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: 60_000, retry: false } },
    });

    function Probe() {
      const query = useActionQuery<{ version: number }>(
        "list-events",
        {},
        { method: "POST" },
      );
      return <div data-version={query.data?.version ?? "loading"} />;
    }

    const { container, root } = mount();

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => {
      expect(container.firstElementChild?.getAttribute("data-version")).toBe(
        "1",
      );
    });
    expect(fetchCount).toBe(1);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agent-native:tool-done", {
          detail: {
            tool: "list-events",
            completedSideEffect: false,
            isError: false,
          },
        }),
      );
      await Promise.resolve();
    });
    expect(fetchCount).toBe(1);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agent-native:tool-done", {
          detail: {
            tool: "manage-event",
            completedSideEffect: true,
            isError: false,
          },
        }),
      );
    });
    await vi.waitFor(() => {
      expect(container.firstElementChild?.getAttribute("data-version")).toBe(
        "2",
      );
    });
    expect(fetchCount).toBe(2);
  });

  it("still invalidates queryClient when an earlier useDbSync without queryClient sees agent-native:tool-done first", async () => {
    let fetchCount = 0;
    const fetchMock = vi.fn(async () => {
      fetchCount += 1;
      return jsonActionResponse({ version: fetchCount });
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: 60_000, retry: false } },
    });
    const observed: Array<{ source?: string; key?: string }> = [];

    function ListenerOnly() {
      useDbSync({ onEvent: (evt) => observed.push(evt) });
      return null;
    }

    function QuerySynced() {
      useDbSync({ queryClient });
      const query = useActionQuery<{ version: number }>(
        "list-tasks",
        {},
        { method: "POST" },
      );
      return <div data-version={query.data?.version ?? "loading"} />;
    }

    const { container, root } = mount();

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ListenerOnly />
          <QuerySynced />
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => {
      expect(
        container.querySelector("[data-version]")?.getAttribute("data-version"),
      ).toBe("1");
    });
    expect(fetchCount).toBe(1);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agent-native:tool-done", {
          detail: {
            tool: "update-task",
            completedSideEffect: true,
            isError: false,
          },
        }),
      );
    });
    await vi.waitFor(() => {
      expect(
        container.querySelector("[data-version]")?.getAttribute("data-version"),
      ).toBe("2");
    });
    expect(observed).toContainEqual(
      expect.objectContaining({ source: "action", key: "update-task" }),
    );
    expect(fetchCount).toBe(2);
  });

  it("defers to useDbSync actionInvalidatePredicate when useDbSync owns the queryClient", async () => {
    let fetchCount = 0;
    const fetchMock = vi.fn(async () => {
      fetchCount += 1;
      return jsonActionResponse({ version: fetchCount });
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: 60_000, retry: false } },
    });

    let predicateCalls = 0;

    function NarrowedSync() {
      useDbSync({
        queryClient,
        actionInvalidatePredicate: (_query, events) => {
          predicateCalls += 1;
          return events.some((evt) => evt.key === "manage-event");
        },
      });
      const query = useActionQuery<{ version: number }>(
        "list-events",
        {},
        { method: "POST" },
      );
      return <div data-version={query.data?.version ?? "loading"} />;
    }

    const { container, root } = mount();

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <NarrowedSync />
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => {
      expect(
        container.querySelector("[data-version]")?.getAttribute("data-version"),
      ).toBe("1");
    });
    expect(fetchCount).toBe(1);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agent-native:tool-done", {
          detail: {
            tool: "send-feedback",
            completedSideEffect: true,
            isError: false,
          },
        }),
      );
    });
    await vi.waitFor(() => {
      expect(predicateCalls).toBeGreaterThan(0);
    });
    expect(fetchCount).toBe(1);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agent-native:tool-done", {
          detail: {
            tool: "manage-event",
            completedSideEffect: true,
            isError: false,
          },
        }),
      );
    });
    await vi.waitFor(() => {
      expect(
        container.querySelector("[data-version]")?.getAttribute("data-version"),
      ).toBe("2");
    });
    expect(fetchCount).toBe(2);
  });
});
