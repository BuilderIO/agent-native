// @vitest-environment happy-dom

import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const analyticsMocks = vi.hoisted(() => ({ trackEvent: vi.fn() }));
vi.mock("./analytics.js", () => analyticsMocks);

const sessionMocks = vi.hoisted(() => ({
  recheckSessionAfterUnauthorized: vi.fn(),
}));
vi.mock("./use-session.js", () => sessionMocks);

import {
  registerActionQueryCacheRevoker,
  setActionQueryCacheBindingToken,
  useActionMutation,
  useActionQuery,
} from "./use-action.js";

const persistHeader = "X-Agent-Native-Browser-Persist";

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: (value: T) => resolvePromise?.(value) };
}

describe("useActionQuery model observers", () => {
  const roots: ReturnType<typeof createRoot>[] = [];
  const containers: HTMLDivElement[] = [];
  let queryClient: QueryClient;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
  });

  afterEach(() => {
    for (const root of roots) act(() => root.unmount());
    for (const container of containers) container.remove();
    roots.length = 0;
    containers.length = 0;
    setActionQueryCacheBindingToken(undefined);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function mount(
    name: string,
    options: Parameters<typeof useActionQuery>[2],
    params?: Record<string, unknown>,
  ): Promise<QueryClient> {
    function Probe() {
      useQueryClient();
      useActionQuery(name as never, params as never, options);
      return null;
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    return queryClient;
  }

  it("captures a read fence and reports exact binding and response permission", async () => {
    const binding = {};
    setActionQueryCacheBindingToken(binding);
    const requestContext = { fence: 4 };
    const onRequestStart = vi.fn(() => requestContext);
    const onServerResult = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ id: "task-1" }, 200, { [persistHeader]: "allow" }),
        ),
    );

    await mount("get-task", { onRequestStart, onServerResult });
    await vi.waitFor(() => expect(onServerResult).toHaveBeenCalledOnce());
    expect(onRequestStart).toHaveBeenCalledOnce();
    expect(onServerResult).toHaveBeenCalledWith(
      { id: "task-1" },
      { requestContext, persistAllowed: true },
    );
  });

  it("does not grant persistence when the binding changes before the response", async () => {
    const firstBinding = {};
    setActionQueryCacheBindingToken(firstBinding);
    const response = deferred<Response>();
    const onServerResult = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => response.promise),
    );

    await mount("get-task", { onServerResult });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    setActionQueryCacheBindingToken({});
    response.resolve(
      jsonResponse({ id: "task-1" }, 200, { [persistHeader]: "allow" }),
    );
    await vi.waitFor(() => expect(onServerResult).toHaveBeenCalledOnce());
    expect(onServerResult.mock.calls[0]?.[1]).toMatchObject({
      persistAllowed: false,
    });
  });

  it("does not call canonical observers for setQueryData optimism", async () => {
    const onRequestStart = vi.fn();
    const onServerResult = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    queryClient.setQueryData(["action", "get-task", undefined], {
      id: "task-1",
      title: "optimistic",
    });
    await mount("get-task", {
      staleTime: Infinity,
      onRequestStart,
      onServerResult,
    });
    await act(async () => Promise.resolve());
    expect(onRequestStart).not.toHaveBeenCalled();
    expect(onServerResult).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([undefined, "Allow"] as const)(
    "does not grant persistence without the exact allow header (%s)",
    async (header) => {
      setActionQueryCacheBindingToken({});
      const onServerResult = vi.fn();
      const headers = header ? { [persistHeader]: header } : {};
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(jsonResponse({ id: "task-1" }, 200, headers)),
      );
      await mount(`get-task-${header ?? "missing"}`, { onServerResult });
      await vi.waitFor(() => expect(onServerResult).toHaveBeenCalledOnce());
      expect(onServerResult.mock.calls[0]?.[1]).toMatchObject({
        persistAllowed: false,
      });
    },
  );

  it("reports a denial after the matching cache binding has been revoked", async () => {
    const binding = {};
    setActionQueryCacheBindingToken(binding);
    let revoked = false;
    const onServerError = vi.fn(() => {
      expect(revoked).toBe(true);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "Forbidden" }, 403)),
    );
    registerActionQueryCacheRevoker(
      queryClient,
      () => {
        revoked = true;
      },
      binding,
    );

    await mount("get-private-task", { onServerError });
    await vi.waitFor(() => expect(onServerError).toHaveBeenCalledOnce());
    expect(onServerError.mock.calls[0]?.[0]).toMatchObject({ status: 403 });
  });

  it("does not publish a result after its request is aborted", async () => {
    const response = deferred<Response>();
    const onRequestStart = vi.fn(() => "request-fence");
    const onServerResult = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => response.promise),
    );
    await mount("get-task", { onRequestStart, onServerResult });
    const queryKey = ["action", "get-task", undefined];
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());

    await act(async () => {
      await queryClient.cancelQueries({ queryKey, exact: true });
    });
    response.resolve(jsonResponse({ id: "task-1" }));
    await act(async () => Promise.resolve());

    expect(onRequestStart).toHaveBeenCalledOnce();
    expect(onServerResult).not.toHaveBeenCalled();
  });

  it("keeps a successful query when request and result observers throw", async () => {
    const onRequestStart = vi.fn(() => {
      throw new Error("secret request observer detail");
    });
    const onServerResult = vi.fn(() => {
      throw new Error("secret result observer detail");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ id: "task-1" })),
    );

    await mount("get-task", { onRequestStart, onServerResult });
    const queryKey = ["action", "get-task", undefined];
    await vi.waitFor(() =>
      expect(queryClient.getQueryState(queryKey)?.status).toBe("success"),
    );

    expect(queryClient.getQueryData(queryKey)).toEqual({ id: "task-1" });
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      "Action read observer could not capture its local fence",
      "Action read result observer failed",
    ]);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("secret"));
  });

  it("preserves the original action error when its error observer throws", async () => {
    const observerFailure = new Error("secret error observer detail");
    const onServerError = vi.fn(() => {
      throw observerFailure;
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "Forbidden" }, 403)),
    );

    await mount("get-private-task", { onServerError });
    const queryKey = ["action", "get-private-task", undefined];
    await vi.waitFor(() =>
      expect(queryClient.getQueryState(queryKey)?.status).toBe("error"),
    );

    const error = queryClient.getQueryState(queryKey)?.error as Error & {
      status?: number;
    };
    expect(error.status).toBe(403);
    expect(error.message).toContain("Forbidden");
    expect(error).not.toBe(observerFailure);
    expect(warn).toHaveBeenCalledWith("Action read error observer failed");
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("secret"));
  });

  it("runs mutation projection before invalidation starts the next read", async () => {
    let fence = 0;
    const events: string[] = [];
    let mutate: (() => Promise<unknown>) | undefined;
    let fetchCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        fetchCount += 1;
        if (init?.method === "POST") {
          return jsonResponse({ id: "task-1", title: "updated" });
        }
        return jsonResponse({
          id: "task-1",
          title: fetchCount === 1 ? "old" : "updated",
        });
      }),
    );

    function Probe() {
      const mutation = useActionMutation("update-task" as never, {
        beforeInvalidate: () => {
          events.push("beforeInvalidate");
          fence += 1;
        },
      });
      mutate = () => mutation.mutateAsync({} as never);
      useActionQuery(
        "get-task",
        {},
        {
          staleTime: Infinity,
          onRequestStart: () => {
            events.push(`requestStart:${fence}`);
            return fence;
          },
          onServerResult: (_result, metadata) => {
            events.push(`serverResult:${metadata.requestContext}`);
          },
        },
      );
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => expect(events).toContain("serverResult:0"));
    await act(async () => {
      await mutate?.();
    });
    await vi.waitFor(() => expect(events).toContain("serverResult:1"));

    expect(events).toEqual([
      "requestStart:0",
      "serverResult:0",
      "beforeInvalidate",
      "requestStart:1",
      "serverResult:1",
    ]);
  });
});
