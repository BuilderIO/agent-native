// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useAgentRouteState,
  useSemanticNavigationState,
} from "./route-state.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function appStateKey(url: RequestInfo | URL): string {
  return String(url).split("/_agent-native/application-state/")[1] ?? "";
}

function makeAppStateFetch(initialState: Record<string, unknown>) {
  const state = { ...initialState };
  const writes: Array<{ key: string; body: unknown; init: RequestInit }> = [];
  const deletes: Array<{ key: string; init: RequestInit }> = [];
  const fetchMock = vi.fn(
    async (url: RequestInfo | URL, init?: RequestInit) => {
      const key = appStateKey(url);
      const method = init?.method ?? "GET";
      if (method === "PUT") {
        const body = JSON.parse(String(init?.body ?? "null"));
        state[key] = body;
        writes.push({ key, body, init: init ?? {} });
        return jsonResponse(body);
      }
      if (method === "DELETE") {
        delete state[key];
        deletes.push({ key, init: init ?? {} });
        return jsonResponse({ ok: true });
      }
      return jsonResponse(state[key] ?? null);
    },
  );
  return { deletes, fetchMock, state, writes };
}

function renderWithQueryClient(element: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>,
    );
  });

  return { container, queryClient, root };
}

describe("route-state client helpers", () => {
  const roots: Root[] = [];
  const containers: HTMLDivElement[] = [];

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    for (const root of roots) {
      act(() => root.unmount());
    }
    for (const container of containers) {
      container.remove();
    }
    Reflect.deleteProperty(document, "startViewTransition");
    vi.unstubAllGlobals();
  });

  it("writes semantic navigation state with request-source metadata", async () => {
    const { fetchMock, writes } = makeAppStateFetch({});
    vi.stubGlobal("fetch", fetchMock);

    function Harness() {
      useSemanticNavigationState({
        state: { view: "inbox", threadId: "thread-1" },
        navigationKeys: ["navigation:tab-1", "navigation"],
        commandKeys: ["navigate:tab-1", "navigate"],
        requestSource: "tab-1",
        commandRefetchInterval: false,
        onCommand: vi.fn(),
      });
      return null;
    }

    const rendered = renderWithQueryClient(<Harness />);
    roots.push(rendered.root);
    containers.push(rendered.container);
    await act(flush);

    expect(writes.map((write) => write.key)).toEqual([
      "navigation:tab-1",
      "navigation",
    ]);
    expect(writes[0].body).toEqual({
      view: "inbox",
      threadId: "thread-1",
    });
    expect(writes[0].init).toMatchObject({
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        "X-Request-Source": "tab-1",
      },
    });
  });

  it("reads the first available command key and deletes the consumed command", async () => {
    const { deletes, fetchMock } = makeAppStateFetch({
      "navigate:tab-1": { view: "thread", threadId: "thread-2", _writeId: "a" },
      navigate: { view: "thread", threadId: "fallback" },
    });
    vi.stubGlobal("fetch", fetchMock);
    const commands: unknown[] = [];

    function Harness() {
      useSemanticNavigationState({
        state: { view: "inbox" },
        navigationKeys: ["navigation"],
        commandKeys: ["navigate:tab-1", "navigate"],
        requestSource: "tab-1",
        commandRefetchInterval: false,
        onCommand: (command) => commands.push(command),
      });
      return null;
    }

    const rendered = renderWithQueryClient(<Harness />);
    roots.push(rendered.root);
    containers.push(rendered.container);
    await act(flush);
    await act(flush);

    expect(commands).toEqual([
      { view: "thread", threadId: "thread-2", _writeId: "a" },
    ]);
    expect(deletes).toEqual([
      {
        key: "navigate:tab-1",
        init: {
          method: "DELETE",
          headers: { "X-Request-Source": "tab-1" },
          keepalive: undefined,
          signal: undefined,
        },
      },
    ]);
    expect(
      fetchMock.mock.calls.some(([url]) => appStateKey(url) === "navigate"),
    ).toBe(false);
  });

  it("derives route state and applies navigate commands with React Router", async () => {
    const { fetchMock, writes } = makeAppStateFetch({
      "navigate:tab-1": { view: "detail", id: "123", _writeId: "cmd-1" },
    });
    vi.stubGlobal("fetch", fetchMock);

    function Harness() {
      const location = useLocation();
      useAgentRouteState<
        {
          view: string;
          label?: string | null;
        },
        {
          view: string;
          id?: string;
          _writeId?: string;
        }
      >({
        browserTabId: "tab-1",
        requestSource: "tab-1",
        refetchInterval: false,
        getNavigationState: ({ pathname, searchParams }) => ({
          view: pathname === "/" ? "home" : pathname.slice(1),
          label: searchParams.get("label"),
        }),
        getCommandPath: (command) =>
          command.view === "detail" && command.id
            ? `/detail/${command.id}`
            : null,
      });
      return <div>{`${location.pathname}${location.search}`}</div>;
    }

    const rendered = renderWithQueryClient(
      <MemoryRouter initialEntries={["/?label=important"]}>
        <Routes>
          <Route path="*" element={<Harness />} />
        </Routes>
      </MemoryRouter>,
    );
    roots.push(rendered.root);
    containers.push(rendered.container);
    await act(flush);
    await act(flush);

    expect(rendered.container.textContent).toBe("/detail/123");
    expect(writes.slice(0, 2).map((write) => write.key)).toEqual([
      "navigation:tab-1",
      "navigation",
    ]);
    expect(writes[0].body).toEqual({
      view: "home",
      label: "important",
    });
    expect(writes.slice(2).map((write) => write.key)).toEqual([
      "navigation:tab-1",
      "navigation",
    ]);
    expect(writes[2].body).toEqual({
      view: "detail/123",
      label: null,
    });
  });

  it("prepares shared chat view transitions before navigate commands", async () => {
    const { fetchMock } = makeAppStateFetch({
      navigate: { view: "detail", id: "123", _writeId: "cmd-1" },
    });
    vi.stubGlobal("fetch", fetchMock);
    const prepare = vi.fn();
    window.addEventListener("agentNative.chatViewTransitionPrepare", prepare);

    function Harness() {
      const location = useLocation();
      useAgentRouteState<
        { view: string },
        { view: string; id?: string; _writeId?: string }
      >({
        refetchInterval: false,
        getNavigationState: ({ pathname }) => ({
          view: pathname === "/" ? "home" : pathname.slice(1),
        }),
        getCommandPath: (command) =>
          command.view === "detail" && command.id
            ? `/detail/${command.id}`
            : null,
        agentChatViewTransition: true,
      });
      return <div>{location.pathname}</div>;
    }

    const rendered = renderWithQueryClient(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="*" element={<Harness />} />
        </Routes>
      </MemoryRouter>,
    );
    roots.push(rendered.root);
    containers.push(rendered.container);
    await act(flush);
    await act(flush);

    expect(prepare).toHaveBeenCalledOnce();
    expect(rendered.container.textContent).toBe("/detail/123");
    window.removeEventListener(
      "agentNative.chatViewTransitionPrepare",
      prepare,
    );
  });
});
