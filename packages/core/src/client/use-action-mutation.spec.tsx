// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useActionMutation, useActionQuery } from "./use-action.js";

describe("useActionMutation", () => {
  const roots: ReturnType<typeof createRoot>[] = [];
  const containers: HTMLDivElement[] = [];

  afterEach(() => {
    for (const root of roots) act(() => root.unmount());
    for (const container of containers) container.remove();
    roots.length = 0;
    containers.length = 0;
    vi.unstubAllGlobals();
  });

  it("keeps mutateAsync pending until an async success callback finishes", async () => {
    let finishSuccess: (() => void) | undefined;
    const successFinished = new Promise<void>((resolve) => {
      finishSuccess = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    let mutation:
      | ReturnType<typeof useActionMutation<Record<string, boolean>>>
      | undefined;
    function Probe() {
      mutation = useActionMutation<Record<string, boolean>>("save-record", {
        onSuccess: () => successFinished,
      });
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });

    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      ),
    );

    let settled = false;
    const result = mutation!.mutateAsync({}).then((value) => {
      settled = true;
      return value;
    });
    await act(async () => Promise.resolve());
    expect(settled).toBe(false);

    finishSuccess?.();
    await expect(result).resolves.toEqual({ ok: true });
    expect(settled).toBe(true);
  });

  it.each(["static", "factory"])(
    "passes %s request headers separately from the mutation payload",
    async (kind) => {
      const fetch = vi.fn().mockImplementation(
        async () =>
          new Response(JSON.stringify({ ok: true }), {
            headers: { "Content-Type": "application/json" },
          }),
      );
      vi.stubGlobal("fetch", fetch);
      let mutation:
        | ReturnType<
            typeof useActionMutation<Record<string, boolean>, { id: string }>
          >
        | undefined;
      const requestHeaders = { "X-Content-Save-Origin": "recovery" };
      const factory = vi.fn(() => requestHeaders);
      function Probe() {
        mutation = useActionMutation<Record<string, boolean>, { id: string }>(
          "save-record",
          {
            headers: kind === "static" ? requestHeaders : factory,
            skipActionQueryInvalidation: true,
          },
        );
        return null;
      }
      const container = document.createElement("div");
      document.body.appendChild(container);
      containers.push(container);
      const root = createRoot(container);
      roots.push(root);
      const queryClient = new QueryClient({
        defaultOptions: { mutations: { retry: false } },
      });
      await act(async () =>
        root.render(
          <QueryClientProvider client={queryClient}>
            <Probe />
          </QueryClientProvider>,
        ),
      );
      const payload = { id: "page" };
      await act(async () => {
        await expect(mutation!.mutateAsync(payload)).resolves.toEqual({
          ok: true,
        });
      });
      expect(fetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          body: JSON.stringify(payload),
          headers: expect.objectContaining(requestHeaders),
        }),
      );
      if (kind === "factory") expect(factory).toHaveBeenCalledWith(payload);
      expect(payload).toEqual({ id: "page" });
    },
  );
});

describe("useActionMutation resource-scoped invalidation", () => {
  const roots: ReturnType<typeof createRoot>[] = [];
  const containers: HTMLDivElement[] = [];

  afterEach(() => {
    for (const root of roots) act(() => root.unmount());
    for (const container of containers) container.remove();
    roots.length = 0;
    containers.length = 0;
    vi.unstubAllGlobals();
  });

  function actionFetchMock() {
    return vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        }),
    );
  }

  function refetchedActionNames(fetch: ReturnType<typeof actionFetchMock>) {
    return fetch.mock.calls
      .filter(([, init]) => (init?.method ?? "GET") === "GET")
      .map(
        ([input]) =>
          String(input).split("/_agent-native/actions/")[1]!.split("?")[0],
      )
      .sort();
  }

  async function mountAndMutate(
    Probe: React.FC<{ mutate: (run: () => Promise<unknown>) => void }>,
    fetch: ReturnType<typeof actionFetchMock>,
  ) {
    vi.stubGlobal("fetch", fetch);
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    let runMutation: (() => Promise<unknown>) | undefined;
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe mutate={(run) => (runMutation = run)} />
        </QueryClientProvider>,
      ),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    fetch.mockClear();
    await act(async () => {
      await runMutation!();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }

  it("refetches only the action queries tagged for the mutated resource", async () => {
    const fetch = actionFetchMock();
    function Probe({
      mutate,
    }: {
      mutate: (run: () => Promise<unknown>) => void;
    }) {
      useActionQuery("list-designs", undefined, { resources: ["design"] });
      useActionQuery("get-design", { id: "d1" }, { resources: ["design"] });
      useActionQuery("list-documents", undefined, { resources: ["document"] });
      const mutation = useActionMutation("update-design", {
        resources: ["design"],
      });
      mutate(() => mutation.mutateAsync({ id: "d1" }));
      return null;
    }

    await mountAndMutate(Probe, fetch);

    expect(refetchedActionNames(fetch)).toEqual(["get-design", "list-designs"]);
  });

  it("still refetches untagged action queries, whose affected set is unknown", async () => {
    const fetch = actionFetchMock();
    function Probe({
      mutate,
    }: {
      mutate: (run: () => Promise<unknown>) => void;
    }) {
      useActionQuery("list-designs", undefined, { resources: ["design"] });
      useActionQuery("list-documents", undefined, { resources: ["document"] });
      useActionQuery("get-settings");
      const mutation = useActionMutation("update-design", {
        resources: ["design"],
      });
      mutate(() => mutation.mutateAsync({ id: "d1" }));
      return null;
    }

    await mountAndMutate(Probe, fetch);

    expect(refetchedActionNames(fetch)).toEqual([
      "get-settings",
      "list-designs",
    ]);
  });

  it("refetches every action query for a write that declares no resources", async () => {
    const fetch = actionFetchMock();
    function Probe({
      mutate,
    }: {
      mutate: (run: () => Promise<unknown>) => void;
    }) {
      useActionQuery("list-designs", undefined, { resources: ["design"] });
      useActionQuery("list-documents", undefined, { resources: ["document"] });
      const mutation = useActionMutation("update-design");
      mutate(() => mutation.mutateAsync({ id: "d1" }));
      return null;
    }

    await mountAndMutate(Probe, fetch);

    expect(refetchedActionNames(fetch)).toEqual([
      "list-designs",
      "list-documents",
    ]);
  });
});
