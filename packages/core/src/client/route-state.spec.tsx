// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
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

function batchedKeys(url: RequestInfo | URL): string[] | null {
  const query = String(url).split("/_agent-native/application-state?keys=")[1];
  if (query === undefined) return null;
  return query.split(",").map(decodeURIComponent);
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
      const keys = batchedKeys(url);
      if (keys) {
        const values: Record<string, unknown> = {};
        for (const batchKey of keys) {
          if (batchKey in state) values[batchKey] = state[batchKey];
        }
        return jsonResponse({
          values,
          missing: keys.filter((batchKey) => !(batchKey in values)),
        });
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

  it("does not stringify unchanged route state on unrelated rerenders", async () => {
    const { fetchMock } = makeAppStateFetch({});
    vi.stubGlobal("fetch", fetchMock);
    const stringify = vi.spyOn(JSON, "stringify");

    let bump: (() => void) | undefined;

    function Harness() {
      const [, setTick] = React.useState(0);
      bump = () => setTick((tick) => tick + 1);
      useAgentRouteState({
        refetchInterval: false,
        getNavigationState: ({ pathname }) => ({
          view: pathname === "/" ? "home" : pathname.slice(1),
        }),
        getCommandPath: () => null,
      });
      return null;
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
    const navigationDedupCallCount = () =>
      stringify.mock.calls.filter(([value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return false;
        }
        return "keys" in value && "state" in value;
      }).length;
    const afterInitialRender = navigationDedupCallCount();

    await act(async () => {
      bump?.();
      await Promise.resolve();
    });

    expect(navigationDedupCallCount()).toBe(afterInitialRender);
  });

  it("updates semantic route state when its callback captures app state", async () => {
    const { fetchMock, writes } = makeAppStateFetch({});
    vi.stubGlobal("fetch", fetchMock);
    let setView: React.Dispatch<React.SetStateAction<string>> | undefined;

    function Harness() {
      const [view, updateView] = React.useState("home");
      setView = updateView;
      useAgentRouteState({
        refetchInterval: false,
        getNavigationState: () => ({ view }),
        getCommandPath: () => null,
      });
      return null;
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
    expect(writes.map((write) => write.body)).toEqual([{ view: "home" }]);

    await act(async () => {
      setView?.("details");
      await Promise.resolve();
    });
    await act(flush);

    expect(writes.map((write) => write.body)).toEqual([
      { view: "home" },
      { view: "details" },
    ]);
  });

  it("does not permanently deduplicate unserializable navigation states", async () => {
    const { fetchMock } = makeAppStateFetch({});
    vi.stubGlobal("fetch", fetchMock);
    const onError = vi.fn();
    const firstState: { self?: unknown } = {};
    firstState.self = firstState;
    const secondState: { self?: unknown } = {};
    secondState.self = secondState;
    let setState:
      | React.Dispatch<React.SetStateAction<{ self?: unknown }>>
      | undefined;

    function Harness() {
      const [state, updateState] = React.useState(firstState);
      setState = updateState;
      useSemanticNavigationState({
        state,
        navigationKeys: ["navigation"],
        commandKeys: ["navigate"],
        commandRefetchInterval: false,
        onCommand: () => {},
        onError,
      });
      return null;
    }

    const rendered = renderWithQueryClient(<Harness />);
    roots.push(rendered.root);
    containers.push(rendered.container);
    await act(flush);
    expect(onError).toHaveBeenCalledTimes(1);

    await act(async () => {
      setState?.(secondState);
      await Promise.resolve();
    });
    await act(flush);

    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("reports an unserializable state once per state, not once per render", async () => {
    // `navigationKeys` is a fresh array on every render, so the write dedup key
    // is recomputed constantly; keyed on anything render-unstable, each re-render
    // issues another failing write and another error.
    const { fetchMock } = makeAppStateFetch({});
    vi.stubGlobal("fetch", fetchMock);
    const onError = vi.fn();
    const circular: { self?: unknown } = {};
    circular.self = circular;
    let rerender: (() => void) | undefined;

    function Harness() {
      const [, bump] = React.useState(0);
      rerender = () => bump((count) => count + 1);
      useSemanticNavigationState({
        state: circular,
        navigationKeys: ["navigation"],
        commandKeys: ["navigate"],
        commandRefetchInterval: false,
        onCommand: () => {},
        onError,
      });
      return null;
    }

    const rendered = renderWithQueryClient(<Harness />);
    roots.push(rendered.root);
    containers.push(rendered.container);
    await act(flush);
    expect(onError).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        rerender?.();
        await Promise.resolve();
      });
      await act(flush);
    }
    expect(onError).toHaveBeenCalledTimes(1);
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
          headers: {
            "X-Agent-Native-CSRF": "1",
            "X-Request-Source": "tab-1",
          },
          keepalive: undefined,
          signal: undefined,
        },
      },
    ]);
    // Reads are batched, so which keys share a request is not a behavioural
    // contract — that only the tab-scoped command was consumed is (above).
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

  it("uses the workspace gateway when a command targets a sibling app", async () => {
    const { fetchMock } = makeAppStateFetch({
      "navigate:tab-1": {
        path: "/seo-application/settings",
        _writeId: "cmd-2",
      },
    });
    const assign = vi.fn();
    const replace = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([
        { id: "market-research", path: "/market-research" },
        { id: "seo-application", path: "/seo-application" },
      ]),
    );
    vi.stubGlobal("window", {
      location: {
        pathname: "/market-research/_agent-native/poll",
        assign,
        replace,
      },
    });

    function Harness() {
      useAgentRouteState({
        browserTabId: "tab-1",
        requestSource: "tab-1",
        refetchInterval: false,
        getNavigationState: ({ pathname }) => ({ view: pathname }),
        getCommandPath: (command: { path?: string }) => command.path,
      });
      return null;
    }

    const rendered = renderWithQueryClient(
      <MemoryRouter initialEntries={["/market-research"]}>
        <Routes>
          <Route path="*" element={<Harness />} />
        </Routes>
      </MemoryRouter>,
    );
    roots.push(rendered.root);
    containers.push(rendered.container);
    await act(flush);
    await act(flush);

    expect(assign).toHaveBeenCalledWith("/seo-application/settings");
    expect(replace).not.toHaveBeenCalled();
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
