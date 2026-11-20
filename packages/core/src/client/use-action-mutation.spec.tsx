// @vitest-environment happy-dom

import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const queryVersion = vi.hoisted(() => ({ legacyCallbacks: false }));
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  const useMutation: typeof actual.useMutation = (options, client) => {
    if (!queryVersion.legacyCallbacks)
      return actual.useMutation(options, client);
    return actual.useMutation(
      {
        ...options,
        onMutate: (variables) =>
          options.onMutate?.(variables, undefined as never),
        mutationFn: (variables) =>
          options.mutationFn?.(variables, undefined as never) ??
          Promise.reject(new Error("Missing mutation function")),
        onSuccess: (data, variables, result) =>
          options.onSuccess?.(data, variables, result, undefined as never),
      },
      client,
    );
  };
  return { ...actual, useMutation };
});

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
    queryVersion.legacyCallbacks = false;
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
    queryVersion.legacyCallbacks = false;
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
    queryClient.getQueryCache().build(queryClient, {
      queryKey: ["other", "design"],
      queryFn: async () => null,
      meta: { actionResources: ["design:d1"] },
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
        const queries = queryClient
          .getQueryCache()
          .getAll()
          .filter((query) => query.queryKey[0] !== "other");
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
    {
      name: "an exact record with a colon in its ID",
      resources: ["design:d1:part"],
      expected: ["design-d1-part", "design-list", "untagged"],
    },
    {
      name: "a type-wide change",
      resources: ["design"],
      expected: [
        "design-d1",
        "design-d1-part",
        "design-d2",
        "design-list",
        "untagged",
      ],
    },
    {
      name: "multiple exact records",
      resources: ["design:d1", "document:doc1"],
      expected: [
        "design-d1",
        "design-list",
        "document-doc1",
        "document-list",
        "untagged",
      ],
    },
  ])(
    "refetches the affected queries for $name",
    async ({ resources, expected }) => {
      const fetch = actionFetchMock();
      function Probe({
        mutate,
      }: {
        mutate: (run: () => Promise<unknown>) => void;
      }) {
        useActionQuery("design-list", undefined, { resources: ["design"] });
        useActionQuery("design-d1", undefined, { resources: ["design:d1"] });
        useActionQuery("design-d1-part", undefined, {
          resources: ["design:d1:part"],
        });
        useActionQuery("design-d2", undefined, { resources: ["design:d2"] });
        useActionQuery("document-list", undefined, { resources: ["document"] });
        useActionQuery("document-doc1", undefined, {
          resources: ["document:doc1"],
        });
        useActionQuery("untagged");
        const mutation = useActionMutation("update-design", { resources });
        mutate(() => mutation.mutateAsync({ id: "d1:part" }));
        return null;
      }

      const { queryClient: client } = await mountAndMutate(Probe, fetch);
      expect(refetchedActionNames(fetch)).toEqual(expected);
      expect(
        client.getQueryCache().find({ queryKey: ["other", "design"] })?.state
          .isInvalidated,
      ).toBe(false);
    },
  );

  it("sends and invalidates a mutation with legacy callback signatures", async () => {
    queryVersion.legacyCallbacks = true;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const fetch = actionFetchMock();
    vi.stubGlobal("fetch", fetch);
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    for (const id of ["old", "other"]) {
      client.getQueryCache().build(client, {
        queryKey: ["action", id],
        queryFn: async () => null,
        meta: { actionResources: [`design:${id}`] },
      });
    }
    const onMutate = vi.fn(() => "caller-context");
    const onSuccess = vi.fn();
    let run: (() => Promise<unknown>) | undefined;
    function Probe() {
      const mutation = useActionMutation("update-design", {
        resources: ["design:old"],
        onMutate,
        onSuccess,
      });
      run = () => mutation.mutateAsync({ id: "old" });
      return null;
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      ),
    );
    await act(async () => expect(await run?.()).toEqual({ ok: true }));
    expect(fetch).toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith(
      { ok: true },
      { id: "old" },
      "caller-context",
      undefined,
    );
    expect(
      client.getQueryCache().find({ queryKey: ["action", "old"] })?.state
        .isInvalidated,
    ).toBe(true);
    expect(
      client.getQueryCache().find({ queryKey: ["action", "other"] })?.state
        .isInvalidated,
    ).toBe(false);
  });

  it.each([false, true])(
    "preserves legacy scopes for overlapping calls (shared variables: %s)",
    async (shared) => {
      queryVersion.legacyCallbacks = true;
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const requests: Array<(response: Response) => void> = [];
      const fetch = vi.fn(
        () => new Promise<Response>((resolve) => requests.push(resolve)),
      );
      vi.stubGlobal("fetch", fetch);
      const client = new QueryClient({
        defaultOptions: { mutations: { retry: false } },
      });
      for (const id of ["old", "new", "other"]) {
        client.getQueryCache().build(client, {
          queryKey: ["action", id],
          queryFn: async () => null,
          meta: { actionResources: [`design:${id}`] },
        });
      }
      const sharedVariables = { id: "same" };
      let run: (() => Promise<unknown>) | undefined;
      function Probe({ id }: { id: string }) {
        const mutation = useActionMutation("update-design", {
          resources: [`design:${id}`],
        });
        run = () => mutation.mutateAsync(shared ? sharedVariables : { id });
        return null;
      }
      const container = document.createElement("div");
      document.body.appendChild(container);
      containers.push(container);
      const root = createRoot(container);
      roots.push(root);
      const render = (id: string) => (
        <QueryClientProvider client={client}>
          <Probe id={id} />
        </QueryClientProvider>
      );
      await act(async () => root.render(render("old")));
      const first = run?.() ?? Promise.reject(new Error("Missing mutation"));
      first.catch(() => {});
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      await act(async () => root.render(render("new")));
      const second = run?.() ?? Promise.reject(new Error("Missing mutation"));
      second.catch(() => {});
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      await act(async () => root.render(render("other")));
      const response = () =>
        new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      await act(async () => {
        requests[1](response());
        await second;
      });
      expect(
        client.getQueryCache().find({ queryKey: ["action", "new"] })?.state
          .isInvalidated,
      ).toBe(true);
      expect(
        client.getQueryCache().find({ queryKey: ["action", "old"] })?.state
          .isInvalidated,
      ).toBe(shared);
      await act(async () => {
        requests[0](response());
        await first;
      });
      expect(
        client.getQueryCache().find({ queryKey: ["action", "old"] })?.state
          .isInvalidated,
      ).toBe(true);
      expect(
        client.getQueryCache().find({ queryKey: ["action", "other"] })?.state
          .isInvalidated,
      ).toBe(false);
    },
  );

  it.each([false, true])(
    "invalidates the invoked resources after options change (marker failure: %s)",
    async (markerFailed) => {
      let finishRequest: ((response: Response) => void) | undefined;
      let requestStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        requestStarted = resolve;
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(() => {
          requestStarted?.();
          return new Promise<Response>((resolve) => {
            finishRequest = resolve;
          });
        }),
      );
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const client = new QueryClient({
        defaultOptions: { mutations: { retry: false } },
      });
      for (const id of ["old", "new", "other"]) {
        client.getQueryCache().build(client, {
          queryKey: ["action", id],
          queryFn: async () => null,
          meta: { actionResources: [`design:${id}`] },
        });
      }
      let run: (() => Promise<unknown>) | undefined;
      function Probe({ id }: { id: string }) {
        const mutation = useActionMutation("update-design", {
          resources: [`design:${id}`],
          skipActionQueryInvalidation: markerFailed,
        });
        run = () => mutation.mutateAsync({ id });
        return null;
      }
      const container = document.createElement("div");
      document.body.appendChild(container);
      containers.push(container);
      const root = createRoot(container);
      roots.push(root);
      const render = (id: string) => (
        <QueryClientProvider client={client}>
          <Probe id={id} />
        </QueryClientProvider>
      );
      await act(async () => root.render(render("old")));
      let pending: Promise<unknown> | undefined;
      await act(async () => {
        pending = run?.();
        await started;
      });
      await act(async () => root.render(render("new")));
      await act(async () => {
        finishRequest?.(
          new Response(JSON.stringify({ ok: true }), {
            headers: {
              "Content-Type": "application/json",
              ...(markerFailed
                ? { "X-Agent-Native-Change-Marker": "failed" }
                : {}),
            },
          }),
        );
        await pending;
      });
      expect(
        client.getQueryCache().find({ queryKey: ["action", "old"] })?.state
          .isInvalidated,
      ).toBe(true);
      expect(
        client.getQueryCache().find({ queryKey: ["action", "new"] })?.state
          .isInvalidated,
      ).toBe(false);
      expect(
        client.getQueryCache().find({ queryKey: ["action", "other"] })?.state
          .isInvalidated,
      ).toBe(false);
    },
  );

  it("keeps independent resource scopes for overlapping mutations", async () => {
    const requests = new Map<string, (response: Response) => void>();
    let notifyStarted: ((id: string) => void) | undefined;
    let started = new Promise<string>((resolve) => {
      notifyStarted = resolve;
    });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: unknown, init: RequestInit) => {
        const { id } = JSON.parse(String(init.body));
        notifyStarted?.(id);
        return new Promise<Response>((resolve) => {
          requests.set(id, resolve);
        });
      }),
    );
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    for (const id of ["old", "new", "other"]) {
      client.getQueryCache().build(client, {
        queryKey: ["action", id],
        queryFn: async () => null,
        meta: { actionResources: [`design:${id}`] },
      });
    }
    let run: (() => Promise<unknown>) | undefined;
    function Probe({ id }: { id: string }) {
      const mutation = useActionMutation("update-design", {
        resources: [`design:${id}`],
      });
      run = () => mutation.mutateAsync({ id });
      return null;
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);
    const render = (id: string) => (
      <QueryClientProvider client={client}>
        <Probe id={id} />
      </QueryClientProvider>
    );
    await act(async () => root.render(render("old")));
    let first: Promise<unknown> | undefined;
    await act(async () => {
      first = run?.();
      expect(await started).toBe("old");
    });
    await act(async () => root.render(render("new")));
    started = new Promise<string>((resolve) => {
      notifyStarted = resolve;
    });
    let second: Promise<unknown> | undefined;
    await act(async () => {
      second = run?.();
      expect(await started).toBe("new");
    });
    await act(async () => root.render(render("other")));
    const response = () =>
      new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    await act(async () => {
      requests.get("new")?.(response());
      await second;
    });
    expect(
      client.getQueryCache().find({ queryKey: ["action", "new"] })?.state
        .isInvalidated,
    ).toBe(true);
    expect(
      client.getQueryCache().find({ queryKey: ["action", "old"] })?.state
        .isInvalidated,
    ).toBe(false);
    await act(async () => {
      requests.get("old")?.(response());
      await first;
    });
    expect(
      client.getQueryCache().find({ queryKey: ["action", "old"] })?.state
        .isInvalidated,
    ).toBe(true);
    expect(
      client.getQueryCache().find({ queryKey: ["action", "other"] })?.state
        .isInvalidated,
    ).toBe(false);
  });

  it("covers both scopes if overlapping calls share variables while cache callbacks wait", async () => {
    const release: Array<() => void> = [];
    const started: Array<() => void> = [];
    const starts = [0, 1].map(
      () =>
        new Promise<void>((resolve) => {
          started.push(resolve);
        }),
    );
    const mutationCache = new MutationCache({
      onMutate: () => {
        const index = release.length;
        const gate = new Promise<void>((resolve) => {
          release.push(resolve);
        });
        started[index]();
        return gate;
      },
    });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", actionFetchMock());
    const client = new QueryClient({
      mutationCache,
      defaultOptions: { mutations: { retry: false } },
    });
    for (const id of ["old", "new", "other"]) {
      client.getQueryCache().build(client, {
        queryKey: ["action", id],
        queryFn: async () => null,
        meta: { actionResources: [`design:${id}`] },
      });
    }
    const variables = { id: "same" };
    let run: (() => Promise<unknown>) | undefined;
    function Probe({ id }: { id: string }) {
      const mutation = useActionMutation("update-design", {
        resources: [`design:${id}`],
      });
      run = () => mutation.mutateAsync(variables);
      return null;
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);
    const render = (id: string) => (
      <QueryClientProvider client={client}>
        <Probe id={id} />
      </QueryClientProvider>
    );
    await act(async () => root.render(render("old")));
    let first: Promise<unknown> | undefined;
    await act(async () => {
      first = run?.();
      await starts[0];
    });
    await act(async () => root.render(render("new")));
    let second: Promise<unknown> | undefined;
    await act(async () => {
      second = run?.();
      await starts[1];
    });
    await act(async () => {
      release[1]();
      await second;
    });
    expect(
      client.getQueryCache().find({ queryKey: ["action", "old"] })?.state
        .isInvalidated,
    ).toBe(true);
    expect(
      client.getQueryCache().find({ queryKey: ["action", "new"] })?.state
        .isInvalidated,
    ).toBe(true);
    expect(
      client.getQueryCache().find({ queryKey: ["action", "other"] })?.state
        .isInvalidated,
    ).toBe(false);
    await act(async () => {
      release[0]();
      await first;
    });
  });

  it.each(["hook", "default", "cache"])(
    "keeps resources when options change while %s onMutate is pending",
    async (source) => {
      let releaseMutate: (() => void) | undefined;
      let notifyStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        notifyStarted = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        releaseMutate = resolve;
      });
      const onMutate = vi.fn(async () => {
        notifyStarted?.();
        await gate;
        return "context";
      });
      const onSuccess = vi.fn();
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      vi.stubGlobal("fetch", actionFetchMock());
      const client = new QueryClient({
        mutationCache: new MutationCache(
          source === "cache" ? { onMutate } : {},
        ),
        defaultOptions: {
          mutations: {
            retry: false,
            ...(source === "default" ? { onMutate } : {}),
          },
        },
      });
      for (const id of ["old", "new"]) {
        client.getQueryCache().build(client, {
          queryKey: ["action", id],
          queryFn: async () => null,
          meta: { actionResources: [`design:${id}`] },
        });
      }
      let run: (() => Promise<unknown>) | undefined;
      function Probe({ id }: { id: string }) {
        const mutation = useActionMutation("update-design", {
          resources: [`design:${id}`],
          ...(source === "hook" ? { onMutate } : {}),
          onSuccess,
        });
        run = () => mutation.mutateAsync({ id });
        return null;
      }
      const container = document.createElement("div");
      document.body.appendChild(container);
      containers.push(container);
      const root = createRoot(container);
      roots.push(root);
      const render = (id: string) => (
        <QueryClientProvider client={client}>
          <Probe id={id} />
        </QueryClientProvider>
      );
      await act(async () => root.render(render("old")));
      let pending: Promise<unknown> | undefined;
      await act(async () => {
        pending = run?.();
        await started;
      });
      await act(async () => root.render(render("new")));
      await act(async () => {
        releaseMutate?.();
        await pending;
      });
      expect(onMutate).toHaveBeenCalledOnce();
      expect(onSuccess).toHaveBeenCalledWith(
        { ok: true },
        { id: "old" },
        source === "cache" ? undefined : "context",
        expect.any(Object),
      );
      expect(
        client.getQueryCache().find({ queryKey: ["action", "old"] })?.state
          .isInvalidated,
      ).toBe(true);
      expect(
        client.getQueryCache().find({ queryKey: ["action", "new"] })?.state
          .isInvalidated,
      ).toBe(false);
    },
  );

  it.each(
    [false, true].flatMap((legacy) =>
      (
        [
          ["pending", false],
          ["pending", true],
          ["uncertain", false],
          ["uncertain", true],
        ] as const
      ).map(([status, skip]) => [legacy, status, skip] as const),
    ),
  )(
    "refreshes affected queries before propagating resolver progress (legacy: %s, status: %s, skip: %s)",
    async (legacy, status, skipActionQueryInvalidation) => {
      queryVersion.legacyCallbacks = legacy;
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
