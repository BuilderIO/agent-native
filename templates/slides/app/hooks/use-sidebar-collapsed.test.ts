// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";
import { useSidebarCollapsed } from "./use-sidebar-collapsed";

const URL = "/_agent-native/application-state/sidebarCollapsed";

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
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
  });

  it("defaults to collapsed=false when the key is missing (404)", async () => {
    stubFetch({ ok: false, status: 404, body: "" });
    const { result } = renderHook(() => useSidebarCollapsed(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.collapsed).toBe(false));
  });

  it("defaults to collapsed=false on an empty body", async () => {
    stubFetch({ ok: true, body: "" });
    const { result } = renderHook(() => useSidebarCollapsed(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.collapsed).toBe(false));
  });

  it("defaults to collapsed=false on malformed JSON", async () => {
    stubFetch({ ok: true, body: "{not json" });
    const { result } = renderHook(() => useSidebarCollapsed(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.collapsed).toBe(false));
  });

  it("reads collapsed=true from a stored value", async () => {
    stubFetch({ ok: true, body: JSON.stringify({ collapsed: true }) });
    const { result } = renderHook(() => useSidebarCollapsed(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.collapsed).toBe(true));
  });

  it("setCollapsed(true) updates state optimistically and PUTs the new value", async () => {
    const stub = stubFetch({ ok: true, body: "" });
    const { result } = renderHook(() => useSidebarCollapsed(), {
      wrapper: makeWrapper(),
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
  });

  it("rolls back (re-fetches truth) when the PUT fails", async () => {
    const stub = stubFetch({
      ok: true,
      body: JSON.stringify({ collapsed: false }),
    });
    const { result } = renderHook(() => useSidebarCollapsed(), {
      wrapper: makeWrapper(),
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
