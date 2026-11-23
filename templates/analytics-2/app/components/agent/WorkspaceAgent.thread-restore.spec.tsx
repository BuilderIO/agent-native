// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";

import { agentScope, agentStorageKey } from "./scope";
import { WorkspaceAgent } from "./WorkspaceAgent";

it("opens an editable notebook composer in Ask approval mode", async () => {
  const orgId = "workspace-one";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const path = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.href,
    ).pathname;
    if (path.endsWith("/auth/session"))
      return Response.json({ email: "qa@example.test", userId: "one", orgId });
    if (path.endsWith("/threads")) return Response.json({ threads: [] });
    return Response.json({ active: false, models: [], engines: [] });
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient();
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <AgentNativeI18nProvider
            catalog={i18nCatalog}
            persistPreference={false}
          >
            <MemoryRouter initialEntries={["/project/notebook-one/latest"]}>
              <WorkspaceAgent
                mode="notebook"
                orgId={orgId}
                projectId="notebook-one"
              />
            </MemoryRouter>
          </AgentNativeI18nProvider>
        </QueryClientProvider>,
      );
    });
    const ask = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Ask",
    );
    expect(ask).toBeDefined();
    expect(host.querySelector('[contenteditable="true"]')).not.toBeNull();
    await act(async () => ask?.click());
    expect(
      document.querySelector('[role="dialog"][aria-label="Approval mode: Ask"]')
        ?.textContent,
    ).toBe("Ask for approval");
  } finally {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  }
});

it("opens the routed transcript without restoring alerts from unrelated saved tabs", async () => {
  const orgId = "workspace-one";
  const scope = agentScope(orgId);
  const openTabsKey = `agent-chat-open-tabs:${agentStorageKey(orgId)}:scope:${scope.type}:${scope.id}`;
  localStorage.setItem(openTabsKey, JSON.stringify(["deleted-thread"]));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const path = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.href,
    ).pathname;
    if (path.endsWith("/auth/session")) {
      return Response.json({
        email: "qa@example.test",
        userId: "user-one",
        orgId,
      });
    }
    if (path.endsWith("/actions/get-agentkit-capabilities")) {
      return Response.json({
        sources: { figma: { available: false } },
        integrations: [],
      });
    }
    if (path.endsWith("/threads")) return Response.json({ threads: [] });
    if (path.endsWith("/threads/deleted-thread")) {
      return new Response(null, { status: 404 });
    }
    if (path.endsWith("/threads/routed-thread")) {
      return Response.json({
        id: "routed-thread",
        scope,
        threadData: JSON.stringify({
          messages: [
            {
              message: {
                id: "message-one",
                role: "user",
                content: [{ type: "text", text: "Recorded conversation" }],
              },
            },
          ],
        }),
      });
    }
    return Response.json({ active: false, models: [], engines: [] });
  });
  vi.stubGlobal("fetch", fetch);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const queryClient = new QueryClient();
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AgentNativeI18nProvider
            catalog={i18nCatalog}
            persistPreference={false}
          >
            <MemoryRouter initialEntries={["/thread/routed-thread"]}>
              <WorkspaceAgent
                mode="thread"
                orgId={orgId}
                threadId="routed-thread"
              />
            </MemoryRouter>
          </AgentNativeI18nProvider>
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(host.textContent).toContain("Recorded conversation");
    });
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/threads/deleted-thread"),
      expect.anything(),
    );
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    host.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  }
});
