// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentNativeI18nProvider } from "../i18n.js";
import { ConnectionsTab } from "./AgentTabsPage.js";

// The Connections tab is directly navigable, so it reads the MCP server list
// eagerly: during the load window it must show a pending state, never the
// "no integrations yet" empty sections that a deferred (idle, dataless)
// query used to produce.
describe("ConnectionsTab direct render", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  it("shows a pending state instead of empty sections while the list loads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AgentNativeI18nProvider>
            <ConnectionsTab />
          </AgentNativeI18nProvider>
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.textContent).not.toContain(
      "No personal agent integrations yet",
    );
    expect(container.textContent).not.toContain(
      "No workspace-shared agent integrations yet",
    );
  });

  it("renders the real sections once the list settles", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          user: [
            {
              id: "server-1",
              scope: "user",
              name: "Example MCP",
              url: "https://mcp.example.com/mcp",
              authMode: "none",
              createdAt: 1,
              mergedId: "server-1",
              status: { state: "connected", toolCount: 3 },
            },
          ],
          org: [],
          orgId: "org-1",
          role: "owner",
        }),
      ),
    );

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AgentNativeI18nProvider>
            <ConnectionsTab />
          </AgentNativeI18nProvider>
        </QueryClientProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Example MCP");
    });
    expect(container.textContent).not.toContain(
      "No personal agent integrations yet",
    );
  });
});
