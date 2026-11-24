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
      useDbSync({ realtime: false, onEvent: (evt) => observed.push(evt) });
      return null;
    }

    function QuerySynced() {
      useDbSync({ queryClient, realtime: false });
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
        realtime: false,
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

  it("schedules a trailing refresh in the fallback when a query is already in flight during agent-native:tool-done", async () => {
    let fetchCount = 0;
    let resolveFirstFetch: ((res: Response) => void) | undefined;
    const fetchMock = vi.fn(() => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return new Promise<Response>((resolve) => {
          resolveFirstFetch = resolve;
        });
      }
      return Promise.resolve(jsonActionResponse({ version: fetchCount }));
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
      expect(fetchCount).toBe(1);
    });

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

    await act(async () => {
      resolveFirstFetch?.(jsonActionResponse({ version: 1 }));
    });

    await vi.waitFor(() => {
      expect(
        container.querySelector("[data-version]")?.getAttribute("data-version"),
      ).toBe("2");
    });
    expect(fetchCount).toBe(2);
  });

  it("delivers onEvent to every useDbSync hook and respects distinct predicates sharing one QueryClient", async () => {
    let tasksFetchCount = 0;
    let eventsFetchCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("list-tasks")) {
        tasksFetchCount += 1;
        return jsonActionResponse({ version: tasksFetchCount });
      }
      eventsFetchCount += 1;
      return jsonActionResponse({ version: eventsFetchCount });
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: 60_000, retry: false } },
    });
    const observedFirst: string[] = [];
    const observedSecond: string[] = [];

    function NarrowedFirst() {
      useDbSync({
        realtime: false,
        queryClient,
        actionInvalidatePredicate: (query) =>
          query.queryKey[1] === "list-events",
        onEvent: (evt) => {
          if (evt.key) observedFirst.push(evt.key);
        },
      });
      const query = useActionQuery<{ version: number }>(
        "list-events",
        {},
        { method: "POST" },
      );
      return <div data-events={query.data?.version ?? "loading"} />;
    }

    function NarrowedSecond() {
      useDbSync({
        realtime: false,
        queryClient,
        actionInvalidatePredicate: (query) =>
          query.queryKey[1] === "list-tasks",
        onEvent: (evt) => {
          if (evt.key) observedSecond.push(evt.key);
        },
      });
      const query = useActionQuery<{ version: number }>(
        "list-tasks",
        {},
        { method: "POST" },
      );
      return <div data-tasks={query.data?.version ?? "loading"} />;
    }

    const { container, root } = mount();

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <NarrowedFirst />
          <NarrowedSecond />
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => {
      expect(
        container.querySelector("[data-events]")?.getAttribute("data-events"),
      ).toBe("1");
      expect(
        container.querySelector("[data-tasks]")?.getAttribute("data-tasks"),
      ).toBe("1");
    });

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
        container.querySelector("[data-tasks]")?.getAttribute("data-tasks"),
      ).toBe("2");
      expect(
        container.querySelector("[data-events]")?.getAttribute("data-events"),
      ).toBe("2");
    });
    expect(observedFirst).toContain("update-task");
    expect(observedSecond).toContain("update-task");
  });

  it("resumes fallback tool-done refreshes after useDbSync unmounts and stops after all queries unmount", async () => {
    let fetchCount = 0;
    const fetchMock = vi.fn(async () => {
      fetchCount += 1;
      return jsonActionResponse({ version: fetchCount });
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: 60_000, retry: false } },
    });

    function App({ withDbSync }: { withDbSync: boolean }) {
      const query = useActionQuery<{ version: number }>(
        "list-events",
        {},
        { method: "POST" },
      );
      return (
        <>
          {withDbSync ? <SyncOwner queryClient={queryClient} /> : null}
          <div data-version={query.data?.version ?? "loading"} />
        </>
      );
    }

    function SyncOwner({ queryClient: qc }: { queryClient: QueryClient }) {
      useDbSync({
        realtime: false,
        queryClient: qc,
        actionInvalidatePredicate: () => false,
      });
      return null;
    }

    const { container, root } = mount();

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <App withDbSync={true} />
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => {
      expect(
        container.querySelector("[data-version]")?.getAttribute("data-version"),
      ).toBe("1");
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <App withDbSync={false} />
        </QueryClientProvider>,
      );
    });

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

    act(() => root.unmount());
    roots.pop();

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    window.dispatchEvent(
      new CustomEvent("agent-native:tool-done", {
        detail: {
          tool: "manage-event",
          completedSideEffect: true,
          isError: false,
        },
      }),
    );
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
