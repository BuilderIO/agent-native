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
  getDefaultMcpIntegrations: () => [],
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
});
