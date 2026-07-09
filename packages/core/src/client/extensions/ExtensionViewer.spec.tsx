import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @vitest-environment happy-dom
import React, { act } from "react";
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
  ShareButton: ({
    onOpenChange,
  }: {
    onOpenChange?: (open: boolean) => void;
  }) => (
    <>
      <button type="button" onClick={() => onOpenChange?.(true)}>
        Share
      </button>
      <button type="button" onClick={() => onOpenChange?.(false)}>
        Close share
      </button>
    </>
  ),
}));

vi.mock("../AgentPanel.js", () => ({
  AgentToggleButton: () => <button type="button">Agent</button>,
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
    expect(iframe.getAttribute("sandbox")).toBe(
      "allow-scripts allow-forms allow-popups allow-downloads",
    );
  });

  it("uses sandboxed srcdoc inside MCP chat embeds to avoid a blocked nested route frame", async () => {
    embedState.active = true;
    const iframe = await renderViewer();

    expect(iframe.getAttribute("src")).toBeNull();
    expect(iframe.getAttribute("srcdoc")).toContain("Star history chart");
    expect(iframe.getAttribute("srcdoc")).toContain(
      "agent-native-extension-binding",
    );
    expect(iframe.getAttribute("sandbox")).toBe(
      "allow-scripts allow-forms allow-popups allow-downloads",
    );
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

  it("shows a clear unavailable state when the extension is not shared", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ error: "Forbidden" }, { status: 403 }),
    );

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
      expect(container.textContent).toContain("Extension is not shared");
    });
    expect(container.textContent).toContain(
      "Ask the owner to share it with your organization",
    );
    expect(container.textContent).toContain("Back to extensions");
    expect(container.querySelector("iframe")).toBeFalsy();
  });

  it("does not keep rendering cached extension data after latest fetch denies access", async () => {
    queryClient.setQueryData(["extension", "ext-1"], extensionResponse, {
      updatedAt: 0,
    });
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ error: "Not found" }, { status: 404 }),
    );

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
      expect(container.textContent).toContain("Extension is unavailable");
    });
    expect(container.textContent).not.toContain("GitHub Stars Over Time");
    expect(container.querySelector("iframe")).toBeFalsy();
  });

  it("shows expired-session copy separately from no-access responses", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ error: "Unauthorized" }, { status: 401 }),
    );

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
      expect(container.textContent).toContain("Session expired");
    });
    expect(container.textContent).toContain("Sign in again");
    expect(container.textContent).not.toContain("Extension is not shared");
    expect(container.querySelector("iframe")).toBeFalsy();
  });

  it("places the more menu before Share and omits the notifications bell", async () => {
    await renderViewer();

    const buttons = Array.from(container.querySelectorAll("button"));
    const moreIndex = buttons.findIndex(
      (button) => button.getAttribute("aria-label") === "More options",
    );
    const shareIndex = buttons.findIndex(
      (button) => button.textContent === "Share",
    );

    expect(moreIndex).toBeGreaterThan(-1);
    expect(shareIndex).toBeGreaterThan(-1);
    expect(moreIndex).toBeLessThan(shareIndex);
    expect(container.textContent).not.toContain("Notifications");
  });

  it("lets toolbar popovers take outside clicks over the extension iframe", async () => {
    const iframe = await renderViewer();
    const buttonNamed = (label: string) =>
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === label,
      );

    expect(iframe.style.pointerEvents).toBe("auto");

    await act(async () => {
      buttonNamed("Share")?.click();
    });

    expect(iframe.style.pointerEvents).toBe("none");

    await act(async () => {
      buttonNamed("Close share")?.click();
    });

    expect(iframe.style.pointerEvents).toBe("auto");
  });
});
