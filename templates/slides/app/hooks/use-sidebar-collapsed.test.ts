import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  useSidebarCollapsed,
} from "./use-sidebar-collapsed";

const URL = "/_agent-native/application-state/sidebarCollapsed";
const QUERY_KEY = ["app-state", "sidebarCollapsed"] as const;

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return { client, Wrapper };
}

interface MockResponse {
  ok: boolean;
  status?: number;
  body: string;
}

function stubFetch(initialGet: MockResponse) {
  const getCalls: string[] = [];
  const putCalls: { url: string; body: string }[] = [];
  let nextGetResponse: MockResponse | null = null;
  let nextPutShouldFail = false;

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      putCalls.push({ url, body: String(init.body ?? "") });
      if (nextPutShouldFail) {
        nextPutShouldFail = false;
        throw new Error("network down");
      }
      return new Response("", { status: 200 });
    }
    getCalls.push(url);
    const response = nextGetResponse ?? initialGet;
    nextGetResponse = null;
    return new Response(response.body, { status: response.status ?? 200 });
  });

  vi.stubGlobal("fetch", fetchMock);

  return {
    fetchMock,
    getCalls,
    putCalls,
    setNextGet: (r: MockResponse) => {
      nextGetResponse = r;
    },
    failNextPut: () => {
      nextPutShouldFail = true;
    },
  };
}

describe("useSidebarCollapsed", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("defaults to collapsed=false when the key is missing (404)", async () => {
    stubFetch({ ok: false, status: 404, body: "" });
    const { result } = renderHook(() => useSidebarCollapsed(), {
      wrapper: makeWrapper().Wrapper,
    });
    await waitFor(() => expect(result.current.collapsed).toBe(false));
  });

  it("defaults to collapsed=false on an empty body", async () => {
    stubFetch({ ok: true, body: "" });
    const { result } = renderHook(() => useSidebarCollapsed(), {
      wrapper: makeWrapper().Wrapper,
    });
    await waitFor(() => expect(result.current.collapsed).toBe(false));
  });

  it("defaults to collapsed=false on malformed JSON", async () => {
    stubFetch({ ok: true, body: "{not json" });
    const { result } = renderHook(() => useSidebarCollapsed(), {
      wrapper: makeWrapper().Wrapper,
    });
    await waitFor(() => expect(result.current.collapsed).toBe(false));
  });

  it("reads collapsed=true from a stored value", async () => {
    stubFetch({ ok: true, body: JSON.stringify({ collapsed: true }) });
    const { result } = renderHook(() => useSidebarCollapsed(), {
      wrapper: makeWrapper().Wrapper,
    });
    await waitFor(() => expect(result.current.collapsed).toBe(true));
  });

  it("uses the browser mirror before the first application-state read completes", async () => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, "true");

    let releaseFetch: (() => void) | null = null;
    const fetchStarted = new Promise<void>((resolve) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          () =>
            new Promise<Response>((responseResolve) => {
              resolve();
              releaseFetch = () => {
                responseResolve(
                  new Response(JSON.stringify({ collapsed: true }), {
                    status: 200,
                  }),
                );
              };
            }),
        ),
      );
    });

    const { result } = renderHook(() => useSidebarCollapsed(), {
      wrapper: makeWrapper().Wrapper,
    });

    expect(result.current.collapsed).toBe(true);
    await fetchStarted;
    releaseFetch!();
    await waitFor(() => expect(result.current.collapsed).toBe(true));
  });

  it("setCollapsed(true) updates state optimistically and PUTs the new value", async () => {
    const stub = stubFetch({ ok: true, body: "" });
    const { result } = renderHook(() => useSidebarCollapsed(), {
      wrapper: makeWrapper().Wrapper,
    });
    await waitFor(() => expect(result.current.collapsed).toBe(false));

    await act(async () => {
      result.current.setCollapsed(true);
    });

    await waitFor(() => expect(result.current.collapsed).toBe(true));
    await waitFor(() => expect(stub.putCalls).toHaveLength(1));
    expect(stub.putCalls[0]).toEqual({
      url: URL,
      body: JSON.stringify({ collapsed: true }),
    });
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe(
      "true",
    );
  });

  it("does not let an in-flight poll overwrite the optimistic update", async () => {
    // Initial fetch: server says collapsed=false.
    const stub = stubFetch({
      ok: true,
      body: JSON.stringify({ collapsed: false }),
    });
    const { client, Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSidebarCollapsed(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.collapsed).toBe(false));

    // Make the *next* GET deliberately slow so it's still in flight when
    // the user toggles. Without cancelQueries, this stale response would
    // arrive after the optimistic write and snap collapsed back to false.
    let releaseSlowGet: (() => void) | null = null;
    let markSlowGetStarted: (() => void) | null = null;
    const slowGetStarted = new Promise<void>((resolve) => {
      markSlowGetStarted = resolve;
    });
    const slowGet = new Promise<void>((resolve) => {
      releaseSlowGet = resolve;
    });
    stub.fetchMock.mockImplementationOnce(async () => {
      markSlowGetStarted!();
      await slowGet;
      return new Response(JSON.stringify({ collapsed: false }), {
        status: 200,
      });
    });

    // Manually invalidate to kick off the slow GET (simulates a poll firing).
    // Then immediately call setCollapsed(true).
    void client.invalidateQueries({ queryKey: QUERY_KEY });
    await slowGetStarted;
    await act(async () => {
      await result.current.setCollapsed(true);
    });

    // Optimistic update committed.
    await waitFor(() => expect(result.current.collapsed).toBe(true));

    // Now release the stale poll — it should NOT overwrite the optimistic
    // value because cancelQueries aborted it.
    releaseSlowGet!();
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.collapsed).toBe(true);
  });

  it("rolls back (re-fetches truth) when the PUT fails", async () => {
    const stub = stubFetch({
      ok: true,
      body: JSON.stringify({ collapsed: false }),
    });
    const { result } = renderHook(() => useSidebarCollapsed(), {
      wrapper: makeWrapper().Wrapper,
    });
    await waitFor(() => expect(result.current.collapsed).toBe(false));

    // Server has the same value (false). PUT will fail; invalidation should
    // re-fetch the truth and drop the optimistic value back to false.
    stub.failNextPut();
    stub.setNextGet({ ok: true, body: JSON.stringify({ collapsed: false }) });
    await act(async () => {
      result.current.setCollapsed(true);
    });

    await waitFor(() => expect(stub.putCalls).toHaveLength(1));
    await waitFor(() => expect(result.current.collapsed).toBe(false));
  });
});
