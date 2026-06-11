// @vitest-environment happy-dom
import React, { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExtensionViewer } from "./ExtensionViewer.js";

const embedState = vi.hoisted(() => ({ active: false }));

vi.mock("../embed-auth.js", () => ({
  ensureEmbedAuthFetchInterceptor: vi.fn(),
  isEmbedMcpChatBridgeActive: () => embedState.active,
}));

vi.mock("../sharing/ShareButton.js", () => ({
  ShareButton: () => <button type="button">Share</button>,
}));

vi.mock("../AgentPanel.js", () => ({
  AgentToggleButton: () => <button type="button">Agent</button>,
}));

vi.mock("../notifications/NotificationsBell.js", () => ({
  NotificationsBell: () => <button type="button">Notifications</button>,
}));

vi.mock("../composer/PromptComposer.js", () => ({
  PromptComposer: () => <div />,
}));

vi.mock("../components/ui/popover.js", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("../components/ui/tooltip.js", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

const extensionResponse = {
  id: "ext-1",
  name: "GitHub Stars Over Time",
  description: "Tracks stars",
  content: "<section>Star history chart</section>",
  updatedAt: "2026-05-22T00:00:00.000Z",
  ownerEmail: "owner@example.test",
  role: "owner",
  canDelete: true,
};

describe("ExtensionViewer MCP embeds", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(extensionResponse)),
    );
    embedState.active = false;
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  async function renderViewer() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/extensions/ext-1/github-stars"]}>
            <ExtensionViewer extensionId="ext-1" />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => {
      expect(container.querySelector("iframe")).toBeTruthy();
    });
    return container.querySelector("iframe") as HTMLIFrameElement;
  }

  it("uses the extension render route in the normal app", async () => {
    const iframe = await renderViewer();

    expect(iframe.getAttribute("src")).toContain(
      "/_agent-native/extensions/ext-1/render",
    );
    expect(iframe.getAttribute("srcdoc")).toBeNull();
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
  });

  it("uses sandboxed srcdoc inside MCP chat embeds to avoid a blocked nested route frame", async () => {
    embedState.active = true;
    const iframe = await renderViewer();

    expect(iframe.getAttribute("src")).toBeNull();
    expect(iframe.getAttribute("srcdoc")).toContain("Star history chart");
    expect(iframe.getAttribute("srcdoc")).toContain(
      "agent-native-extension-binding",
    );
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
  });

  it("does not flash not-found while a cached null extension is refetching", async () => {
    let resolveFetch: (response: Response) => void = () => {};
    const pendingFetch = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.mocked(fetch).mockImplementationOnce(() => pendingFetch);
    queryClient.setQueryData(["extension", "ext-1"], null);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/extensions/ext-1/github-stars"]}>
            <ExtensionViewer extensionId="ext-1" />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });

    expect(container.textContent).not.toContain("Extension not found");
    expect(container.querySelector(".animate-pulse")).toBeTruthy();

    await act(async () => {
      resolveFetch(Response.json(extensionResponse));
      await pendingFetch;
    });

    await vi.waitFor(() => {
      expect(container.querySelector("iframe")).toBeTruthy();
    });
  });
});
