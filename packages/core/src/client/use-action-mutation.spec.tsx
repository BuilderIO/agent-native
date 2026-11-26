// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ACTION_BATCH_ACTION_NAME } from "../shared/action-batch.js";
import {
  ACTION_CACHE_FLUSH_EVENT,
  readMutationEpoch,
} from "./action-query-cache-mutation.js";
import {
  ProviderWriteFailedError,
  ProviderWritePendingError,
  ProviderWriteUncertainError,
  waitForProviderWriteResult,
} from "./provider-writes.js";
import { recordSessionIdentity } from "./session-identity.js";
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

  it("resolves a queued result before success and waits for the success callback", async () => {
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
        resolveResult: async (data) => ({ ...data, resumed: true }),
        onSuccess: (data) => {
          expect(data).toEqual({ ok: true, resumed: true });
          return successFinished;
        },
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
    await expect(result).resolves.toEqual({ ok: true, resumed: true });
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

  it.each([
    { skip: false, settles: true },
    { skip: true, settles: false },
  ])(
    "reports its own epoch on the flush event only when it invalidated (skip: $skip)",
    async ({ skip, settles }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ ok: true }), {
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );
      const settled: unknown[] = [];
      const listen = (event: Event) =>
        settled.push((event as CustomEvent).detail?.settledEpoch);
      window.addEventListener(ACTION_CACHE_FLUSH_EVENT, listen);
      let mutation:
        | ReturnType<typeof useActionMutation<Record<string, boolean>>>
        | undefined;
      function Probe() {
        mutation = useActionMutation<Record<string, boolean>>("save-record", {
          skipActionQueryInvalidation: skip,
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
      try {
        await act(async () => {
          await mutation?.mutateAsync({});
        });
        await vi.waitFor(() => expect(settled).toHaveLength(1));
      } finally {
        window.removeEventListener(ACTION_CACHE_FLUSH_EVENT, listen);
      }
      expect(settled[0]).toBe(settles ? readMutationEpoch() : undefined);
      expect(settles).toBe(typeof settled[0] === "string");
    },
  );

  it("mints a signed UI capability before a uiOnly mutation", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    let mutation:
      | ReturnType<typeof useActionMutation<{ ok: boolean }, { id: string }>>
      | undefined;
    function Probe() {
      mutation = useActionMutation<{ ok: boolean }, { id: string }>(
        "confirm-messaging-channel-credential-removal" as never,
        { uiOnly: true },
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
    await act(async () => {
      await mutation!.mutateAsync({ id: "telegram" });
    });

    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "/_agent-native/ui-capability",
      "/_agent-native/actions/confirm-messaging-channel-credential-removal",
    ]);
  });
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
    recordSessionIdentity(undefined);
  });

  // A batch POST gets one result per request, as the batch action answers; any
  // other reply trips the action failure circuit and blocks later fetches.
  // `writeHeaders` ride on the reply to a POST write, as the server sets them.
  function actionFetchMock(
    writeHeaders: Record<string, string> = {},
    readBody: (action: string) => unknown = () => ({ ok: true }),
  ) {
    return vi.fn(async (input: unknown, init?: RequestInit) => {
      const json = (body: unknown, headers: Record<string, string> = {}) =>
        new Response(JSON.stringify(body), {
          headers: { "Content-Type": "application/json", ...headers },
        });
      if (
        init?.method === "POST" &&
        String(input).endsWith(`/${ACTION_BATCH_ACTION_NAME}`)
      ) {
        const { requests } = JSON.parse(String(init.body));
        return json({
          results: requests.map((request: { action: string }) => ({
            status: 200,
            body: readBody(request.action),
          })),
        });
      }
      if (init?.method === "POST") return json({ ok: true }, writeHeaders);
      const action = String(input)
        .split("/_agent-native/actions/")[1]
        ?.split("?")[0];
      if (!action) throw new Error("Unexpected action query in fixture");
      return json(readBody(action));
    });
  }

  // Two or more same-tick GETs travel as one batch POST, so the action names
  // come from its body rather than from the URL.
  function refetchedActionNames(fetch: ReturnType<typeof actionFetchMock>) {
    return fetch.mock.calls
      .flatMap(([input, init]) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (method === "POST" && url.endsWith(`/${ACTION_BATCH_ACTION_NAME}`)) {
          const { requests } = JSON.parse(String(init?.body));
          return requests.map((request: { action: string }) => request.action);
        }
        if (method !== "GET") return [];
        return [url.split("/_agent-native/actions/")[1]!.split("?")[0]];
      })
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
    await act(async () => {
      await vi.waitFor(() => {
        const queries = queryClient.getQueryCache().getAll();
        expect(queries.length).toBeGreaterThan(0);
        expect(queries.every((query) => query.state.status === "success")).toBe(
          true,
        );
      });
    });
    fetch.mockClear();
    await act(async () => {
      await runMutation!();
      await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
    });
    return { queryClient, root };
  }

  async function mountPendingProviderWrite() {
    let providerValue = "before";
    const fetch = actionFetchMock({}, (action) => ({
      value: action === "get-design" ? providerValue : "unrelated",
    }));
    const progress = {
      id: "pending-design-write",
      status: "queued" as const,
      attempts: 1,
      reason: null,
      resumeAt: null,
    };
    const onSuccess = vi.fn();
    let writeCalls = 0;
    function Probe({
      mutate,
    }: {
      mutate: (run: () => Promise<unknown>) => void;
    }) {
      const design = useActionQuery<{ value: string }>(
        "get-design",
        { id: "d1" },
        {
          resources: ["design"],
        },
      );
      useActionQuery("list-documents", undefined, { resources: ["document"] });
      const mutation = useActionMutation("update-design", {
        resources: ["design"],
        resolveResult: async () => {
          writeCalls++;
          return waitForProviderWriteResult<unknown>(
            { _providerWrite: progress },
            {
              resume: vi.fn(),
              maxWaitMs: 0,
            },
          );
        },
        onSuccess,
      });
      mutate(() =>
        expect(mutation.mutateAsync({ id: "d1" })).rejects.toBeInstanceOf(
          ProviderWritePendingError,
        ),
      );
      return <span>{design.data?.value}</span>;
    }
    const view = await mountAndMutate(Probe, fetch);
    const designQuery = view.queryClient
      .getQueryCache()
      .getAll()
      .find((query) => query.queryKey[1] === "get-design");
    if (!designQuery) throw new Error("Design query fixture is unavailable");
    return {
      ...view,
      fetch,
      designQuery,
      progress,
      onSuccess,
      writeCalls: () => writeCalls,
      setProviderValue: (value: string) => {
        providerValue = value;
      },
      mutationRequests: () =>
        fetch.mock.calls.filter(
          ([input, init]) =>
            init?.method === "POST" && String(input).endsWith("/update-design"),
        ),
      observe: (receipt: unknown, observed = progress) =>
        waitForProviderWriteResult<unknown>(
          { _providerWrite: observed },
          { resume: async () => receipt },
        ),
    };
  }

  it("refreshes affected queries after a timed-out write is explicitly observed complete", async () => {
    const view = await mountPendingProviderWrite();
    expect(view.designQuery.state.data).toEqual({ value: "before" });
    expect(view.mutationRequests()).toHaveLength(1);
    view.setProviderValue("after");
    view.fetch.mockClear();
    const completed = {
      ...view.progress,
      status: "completed",
      reason: null,
      resumeAt: null,
    };

    await act(async () => {
      await expect(
        view.observe({ progress: completed }),
      ).rejects.toBeInstanceOf(ProviderWritePendingError);
    });
    expect(view.designQuery.state.data).toEqual({ value: "before" });
    expect(refetchedActionNames(view.fetch)).toEqual([]);

    const unrelated = { ...view.progress, id: "another-write" };
    await act(async () => {
      await view.observe(
        {
          progress: { ...completed, id: unrelated.id },
          result: { id: "unrelated-item" },
        },
        unrelated,
      );
    });
    expect(view.designQuery.state.data).toEqual({ value: "before" });
    expect(refetchedActionNames(view.fetch)).toEqual([]);

    await act(async () => {
      await view.observe({ progress: completed, result: { id: "d1" } });
      await vi.waitFor(() => expect(view.queryClient.isFetching()).toBe(0));
    });
    expect(view.designQuery.state.data).toEqual({ value: "after" });
    expect(refetchedActionNames(view.fetch)).toEqual(["get-design"]);
    expect(view.writeCalls()).toBe(1);
    expect(view.mutationRequests()).toHaveLength(0);
    expect(view.onSuccess).not.toHaveBeenCalled();
  });

  it.each(["unmount", "session"] as const)(
    "disposes pending completion refreshes on %s",
    async (lifecycle) => {
      const view = await mountPendingProviderWrite();
      expect(view.designQuery.state.data).toEqual({ value: "before" });
      expect(view.designQuery.state.isInvalidated).toBe(false);
      if (lifecycle === "unmount") act(() => view.root.unmount());
      if (lifecycle === "session")
        act(() => recordSessionIdentity("next-test-session"));
      view.setProviderValue("after");
      view.fetch.mockClear();
      await act(async () => {
        await view.observe({
          progress: { ...view.progress, status: "completed" },
          result: { id: "d1" },
        });
        await vi.waitFor(() => expect(view.queryClient.isFetching()).toBe(0));
      });
      expect(view.designQuery.state.data).toEqual({ value: "before" });
      expect(view.designQuery.state.isInvalidated).toBe(false);
      expect(refetchedActionNames(view.fetch)).toEqual([]);
      expect(view.writeCalls()).toBe(1);
      expect(view.mutationRequests()).toHaveLength(0);
      expect(view.onSuccess).not.toHaveBeenCalled();
    },
  );

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

  it.each([
    ["pending", false],
    ["pending", true],
    ["uncertain", false],
    ["uncertain", true],
  ] as const)(
    "refreshes affected queries before propagating %s resolver progress (skip: %s)",
    async (status, skipActionQueryInvalidation) => {
      const fetch = actionFetchMock();
      const progress = {
        id: "provider-write-a",
        status:
          status === "pending" ? ("queued" as const) : ("uncertain" as const),
        attempts: 1,
        reason: status === "pending" ? "operator" : "result_unavailable",
        resumeAt: null,
      };
      const error =
        status === "pending"
          ? new ProviderWritePendingError(progress)
          : new ProviderWriteUncertainError(progress);
      const onSuccess = vi.fn();
      function Probe({
        mutate,
      }: {
        mutate: (run: () => Promise<unknown>) => void;
      }) {
        useActionQuery("list-designs", undefined, { resources: ["design"] });
        useActionQuery("get-design", { id: "d1" }, { resources: ["design"] });
        useActionQuery("list-documents", undefined, {
          resources: ["document"],
        });
        const mutation = useActionMutation("update-design", {
          resources: ["design"],
          skipActionQueryInvalidation,
          resolveResult: async () => {
            throw error;
          },
          onSuccess,
        });
        mutate(async () => {
          await expect(mutation.mutateAsync({ id: "d1" })).rejects.toBe(error);
          expect(refetchedActionNames(fetch)).toEqual([
            "get-design",
            "list-designs",
          ]);
        });
        return null;
      }
      await mountAndMutate(Probe, fetch);
      expect(onSuccess).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["ordinary", false],
    ["ordinary", true],
    ["failed", false],
    ["failed", true],
  ] as const)(
    "refreshes an unconfirmed %s resolver outcome while preserving known rejection (skip: %s)",
    async (kind, skipActionQueryInvalidation) => {
      const fetch = actionFetchMock();
      const error =
        kind === "ordinary"
          ? new Error("Invalid action result")
          : new ProviderWriteFailedError({
              id: "provider-write-a",
              status: "failed",
              attempts: 1,
              reason: "provider_rejected",
              resumeAt: null,
            });
      function Probe({
        mutate,
      }: {
        mutate: (run: () => Promise<unknown>) => void;
      }) {
        useActionQuery("list-designs", undefined, { resources: ["design"] });
        const mutation = useActionMutation("update-design", {
          resources: ["design"],
          skipActionQueryInvalidation,
          resolveResult: async () => {
            throw error;
          },
        });
        mutate(() =>
          expect(mutation.mutateAsync({ id: "d1" })).rejects.toBe(error),
        );
        return null;
      }
      await mountAndMutate(Probe, fetch);
      expect(refetchedActionNames(fetch)).toEqual(
        kind === "failed" ? [] : ["list-designs"],
      );
    },
  );

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

  function invalidationProbe({
    skipActionQueryInvalidation,
  }: {
    skipActionQueryInvalidation: boolean;
  }) {
    return function Probe({
      mutate,
    }: {
      mutate: (run: () => Promise<unknown>) => void;
    }) {
      useActionQuery("list-designs", undefined, { resources: ["design"] });
      useActionQuery("get-design", { id: "d1" }, { resources: ["design"] });
      useActionQuery("list-documents", undefined, { resources: ["document"] });
      const mutation = useActionMutation("update-design", {
        resources: ["design"],
        skipActionQueryInvalidation,
      });
      mutate(() => mutation.mutateAsync({ id: "d1" }));
      return null;
    };
  }

  it("refetches a skipped write's queries when its change marker failed", async () => {
    const fetch = actionFetchMock({
      "X-Agent-Native-Change-Marker": "failed",
    });

    await mountAndMutate(
      invalidationProbe({ skipActionQueryInvalidation: true }),
      fetch,
    );

    expect(refetchedActionNames(fetch)).toEqual(["get-design", "list-designs"]);
  });

  it("leaves a skipped write's queries alone when its change marker landed", async () => {
    const fetch = actionFetchMock();

    await mountAndMutate(
      invalidationProbe({ skipActionQueryInvalidation: true }),
      fetch,
    );

    expect(refetchedActionNames(fetch)).toEqual([]);
  });

  it("refetches a normal write's queries once when its change marker failed", async () => {
    const fetch = actionFetchMock({
      "X-Agent-Native-Change-Marker": "failed",
    });

    await mountAndMutate(
      invalidationProbe({ skipActionQueryInvalidation: false }),
      fetch,
    );

    expect(refetchedActionNames(fetch)).toEqual(["get-design", "list-designs"]);
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
