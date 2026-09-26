// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MCP_OAUTH_FLOW_TTL_MS } from "../../shared/mcp-oauth-flow-ttl.js";
import {
  clearMcpConnectionPending,
  hasPendingMcpConnection,
  markMcpConnectionPending,
} from "./mcp-connection-refresh.js";
import { notifyMcpConnectionComplete } from "./mcp-connection-resume.js";
import { navigateToMcpOAuthStart } from "./mcp-integration-catalog.js";
import {
  McpServersApiProvider,
  useMcpServers,
  type McpServer,
  type McpServersApi,
  type McpServersList,
} from "./use-mcp-servers.js";

function connectedServer(url: string): McpServer {
  return {
    id: "server-1",
    scope: "user",
    name: "Sentry",
    url,
    authMode: "oauth",
    createdAt: 0,
    mergedId: "user:server-1",
    status: { state: "connected", toolCount: 4 },
  };
}

describe("MCP connection pending window", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    clearMcpConnectionPending();
  });

  it("stays pending inside the TTL and expires after it", () => {
    const startedAt = 1_000_000;
    markMcpConnectionPending(startedAt);

    expect(hasPendingMcpConnection(startedAt + 60_000)).toBe(true);
    // authorization, so a slow consent is never stranded.
    expect(
      hasPendingMcpConnection(startedAt + MCP_OAUTH_FLOW_TTL_MS - 1_000),
    ).toBe(true);
    expect(
      hasPendingMcpConnection(startedAt + MCP_OAUTH_FLOW_TTL_MS + 1_000),
    ).toBe(false);
    expect(hasPendingMcpConnection(startedAt + 60_000)).toBe(false);
  });

  it("reports no pending connection before any authorization starts", () => {
    expect(hasPendingMcpConnection()).toBe(false);
  });

  it("marks a pending connection when the OAuth popup is opened", () => {
    const open = vi.spyOn(window, "open").mockReturnValue({
      opener: window,
    } as unknown as Window);

    expect(
      navigateToMcpOAuthStart("/_agent-native/mcp/servers/oauth/start?x=1"),
    ).toBe(true);
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining("/_agent-native/mcp/servers/oauth/start?x=1"),
      "_blank",
      "width=640,height=760",
    );
    expect(hasPendingMcpConnection()).toBe(true);
  });

  it("does not mark a pending connection when the popup is blocked", () => {
    vi.spyOn(window, "open").mockReturnValue(null);

    expect(navigateToMcpOAuthStart("/start")).toBe(false);
    expect(hasPendingMcpConnection()).toBe(false);
  });
});

describe("useMcpServers post-OAuth revalidation", () => {
  const roots: Root[] = [];
  const containers: HTMLDivElement[] = [];
  let list: McpServersList;
  let listCalls: number;
  let api: McpServersApi;

  function renderList() {
    const container = document.createElement("div");
    document.body.append(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);

    function Probe() {
      const query = useMcpServers();
      const urls = [
        ...(query.data?.user ?? []),
        ...(query.data?.org ?? []),
      ].map((server) => server.url);
      return <div data-testid="urls">{urls.join(",")}</div>;
    }

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false },
      },
    });
    act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <McpServersApiProvider api={api}>
            <Probe />
          </McpServersApiProvider>
        </QueryClientProvider>,
      );
    });
    return container;
  }

  function setVisibility(state: DocumentVisibilityState) {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: function () {
        return state;
      },
    });
  }

  async function settle() {
    await act(async () => {
      for (let turn = 0; turn < 5; turn += 1) {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.sessionStorage.clear();
    clearMcpConnectionPending();
    listCalls = 0;
    list = { user: [], org: [], orgId: null, role: null };
    api = {
      list: async () => {
        listCalls += 1;
        return list;
      },
      create: vi.fn(),
      delete: vi.fn(),
      reconnect: vi.fn(),
      test: vi.fn(),
      testExisting: vi.fn(),
    } as unknown as McpServersApi;
  });

  afterEach(() => {
    for (const root of roots) act(() => root.unmount());
    for (const container of containers) container.remove();
    roots.length = 0;
    containers.length = 0;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    clearMcpConnectionPending();
    setVisibility("visible");
  });

  it("shows an integration as connected after returning from the OAuth popup", async () => {
    const container = renderList();
    await settle();
    expect(container.querySelector("[data-testid=urls]")?.textContent).toBe("");

    markMcpConnectionPending();
    list = {
      user: [connectedServer("https://mcp.sentry.dev/mcp")],
      org: [],
      orgId: null,
      role: null,
    };

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await settle();

    expect(container.querySelector("[data-testid=urls]")?.textContent).toBe(
      "https://mcp.sentry.dev/mcp",
    );
  });

  it("revalidates when the tab becomes visible again", async () => {
    const container = renderList();
    await settle();

    markMcpConnectionPending();
    list = {
      user: [connectedServer("https://mcp.notion.com/mcp")],
      org: [],
      orgId: null,
      role: null,
    };

    setVisibility("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await settle();

    expect(container.querySelector("[data-testid=urls]")?.textContent).toBe(
      "https://mcp.notion.com/mcp",
    );
  });

  it("ignores a visibilitychange that leaves the tab hidden", async () => {
    renderList();
    await settle();
    const callsAfterMount = listCalls;

    markMcpConnectionPending();
    setVisibility("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await settle();

    expect(listCalls).toBe(callsAfterMount);
  });

  it("revalidates when a connection completion is announced", async () => {
    const container = renderList();
    await settle();

    markMcpConnectionPending();
    list = {
      user: [connectedServer("https://mcp.linear.app/mcp")],
      org: [],
      orgId: null,
      role: null,
    };

    act(() => {
      notifyMcpConnectionComplete();
    });
    await settle();

    expect(container.querySelector("[data-testid=urls]")?.textContent).toBe(
      "https://mcp.linear.app/mcp",
    );
  });

  it("keeps revalidating until the TTL rather than guessing the flow finished", async () => {
    const container = renderList();
    await settle();

    markMcpConnectionPending();
    list = {
      user: [connectedServer("https://mcp.sentry.dev/mcp")],
      org: [],
      orgId: null,
      role: null,
    };

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await settle();
    const callsAfterFirstReturn = listCalls;

    list = {
      user: [
        connectedServer("https://mcp.sentry.dev/mcp"),
        { ...connectedServer("https://mcp.notion.com/mcp"), id: "server-2" },
      ],
      org: [],
      orgId: null,
      role: null,
    };
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await settle();

    expect(listCalls).toBeGreaterThan(callsAfterFirstReturn);
    expect(
      container.querySelector("[data-testid=urls]")?.textContent,
    ).toContain("https://mcp.notion.com/mcp");
  });

  it("does not treat a first list load as the pending connection landing", async () => {
    markMcpConnectionPending();
    list = {
      user: [connectedServer("https://mcp.sentry.dev/mcp")],
      org: [],
      orgId: null,
      role: null,
    };

    renderList();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await settle();

    expect(hasPendingMcpConnection()).toBe(true);
  });

  it("does not refetch on focus when no authorization is pending", async () => {
    renderList();
    await settle();
    const callsAfterMount = listCalls;

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await settle();

    expect(listCalls).toBe(callsAfterMount);
  });
});
