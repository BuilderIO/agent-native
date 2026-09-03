// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mcpMocks = vi.hoisted(() => ({
  useCreateMcpServer: vi.fn(),
  useDeleteMcpServer: vi.fn(),
  useMcpServers: vi.fn(),
  useReconnectMcpServer: vi.fn(),
}));

const reconnectMutation = vi.hoisted(() => vi.fn());

const integrationMocks = vi.hoisted(() => ({
  useIntegrationStatus: vi.fn(),
}));

vi.mock("../resources/McpIntegrationDialog.js", () => ({
  McpIntegrationDialog: () => null,
}));

vi.mock("../resources/mcp-integration-catalog.js", () => ({
  getDefaultMcpIntegrations: () => [
    {
      id: "context7",
      name: "Context7",
      provider: "context7",
      description: "Fetch current library docs in agent chats.",
      useCase: "documentation",
      url: "https://mcp.context7.com/mcp",
      authMode: "none",
      connectionMode: "direct",
      availability: "ready",
      logoUrl: "",
    },
    {
      id: "builder-cms",
      name: "Builder.io",
      provider: "builder",
      description: "Search Builder Publish and Hybrid Space content.",
      useCase: "content models",
      url: "https://mcp.builder.io/mcp/publish",
      authMode: "oauth",
      connectionMode: "oauth",
      availability: "ready",
      logoUrl: "",
    },
  ],
}));

vi.mock("../resources/use-mcp-servers.js", () => mcpMocks);

vi.mock("./useIntegrationStatus.js", () => integrationMocks);

vi.mock("../i18n.js", () => ({
  useT: () => (key: string, options?: Record<string, unknown>) => {
    const messages: Record<string, string> = {
      "mcpIntegrations.connectionError": "Connection error",
      "mcpIntegrations.connectionErrorReason": "Reason: {{reason}}",
      "mcpIntegrations.reconnect": "Reconnect",
      "mcpIntegrations.reconnecting": "Reconnecting…",
      "mcpIntegrations.reconnectFailed": "Reconnect failed: {{error}}",
    };
    return (messages[key] ?? key).replace(
      /\{\{(\w+)\}\}/g,
      (_match, name: string) => String(options?.[name] ?? ""),
    );
  },
}));

import { IntegrationsPanel } from "./IntegrationsPanel.js";

describe("IntegrationsPanel MCP connection errors", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.history.replaceState({}, "", "/settings/integrations");

    mcpMocks.useMcpServers.mockReturnValue({
      data: {
        user: [],
        org: [
          {
            id: "fullstory-1",
            scope: "org",
            name: "fullstory",
            url: "https://fullstory.example/mcp",
            authMode: "headers",
            createdAt: 1,
            mergedId: "org-acme-fullstory",
            status: {
              state: "error",
              error:
                "The MCP server rejected the request. Reconnect or update the required Authorization header.",
            },
          },
        ],
        orgId: "acme",
        role: "member",
      },
      isError: false,
      isLoading: false,
    });
    mcpMocks.useCreateMcpServer.mockReturnValue({ mutateAsync: vi.fn() });
    mcpMocks.useDeleteMcpServer.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    });
    reconnectMutation.mockReset();
    reconnectMutation.mockResolvedValue({ ok: true });
    mcpMocks.useReconnectMcpServer.mockReturnValue({
      mutateAsync: reconnectMutation,
    });
    integrationMocks.useIntegrationStatus.mockReturnValue({
      statuses: [],
      loading: false,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("shows the connection cause and reconnects the saved server", async () => {
    await act(async () => {
      root.render(<IntegrationsPanel />);
    });

    expect(container.textContent).toContain(
      "Reason: The MCP server rejected the request. Reconnect or update the required Authorization header.",
    );
    const reconnectButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Reconnect"));
    expect(reconnectButton).toBeTruthy();

    await act(async () => {
      reconnectButton?.click();
    });

    expect(reconnectMutation).toHaveBeenCalledWith({
      id: "fullstory-1",
      scope: "org",
    });
  });

  it("renders the catalog while saved connections are still loading", async () => {
    mcpMocks.useMcpServers.mockReturnValue({
      data: undefined,
      isError: false,
      isLoading: true,
    });

    await act(async () => {
      root.render(<IntegrationsPanel />);
    });

    expect(container.textContent).toContain("Available integrations");
    expect(container.textContent).toContain("Context7");
    expect(container.textContent).not.toContain("Builder.io");
    expect(container.querySelector(".animate-pulse")).toBeNull();
  });

  it.each([
    ["Claude Cowork", "codex"],
    ["Claude Code", "claude-code"],
    ["Anthropic", "claude"],
    ["OpenAI", "chatgpt"],
    ["Codex", "codex"],
    ["OpenAI Codex", "codex"],
    ["Cursor", "cursor"],
    ["xAI", "grok"],
  ])("routes %s searches to the shared MCP guide", async (query, guide) => {
    await act(async () => {
      root.render(<IntegrationsPanel />);
    });

    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search integrations"]',
    );
    expect(search).not.toBeNull();
    await act(async () => {
      if (!search) return;
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(search, query);
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.textContent).toContain("settings.mcpClientSetup");
    expect(container.textContent).not.toContain(
      "Let Claude Code call this agent via A2A",
    );
    expect(container.textContent).not.toContain(
      `No agent integrations match “${query.toLowerCase()}”`,
    );

    const connect = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "mcpIntegrations.connect",
    );
    expect(connect).toBeTruthy();
    await act(async () => connect?.click());
    expect(window.location.pathname).toBe("/settings/mcp");
    expect(new URLSearchParams(window.location.search).get("guide")).toBe(
      guide,
    );
  });

  it("keeps the MCP guide route inside the mounted app", async () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/content");
    window.history.replaceState({}, "", "/content/settings/integrations");

    await act(async () => {
      root.render(<IntegrationsPanel />);
    });

    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search integrations"]',
    );
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(search, "Cursor");
      search?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const connect = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "mcpIntegrations.connect",
    );
    await act(async () => connect?.click());

    expect(window.location.pathname).toBe("/content/settings/mcp");
    expect(new URLSearchParams(window.location.search).get("guide")).toBe(
      "cursor",
    );
  });
});
