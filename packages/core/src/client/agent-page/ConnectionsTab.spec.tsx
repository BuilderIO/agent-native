// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mcpMocks = vi.hoisted(() => ({
  refetch: vi.fn(),
  useCreateMcpServer: vi.fn(),
  useDeleteMcpServer: vi.fn(),
  useMcpServers: vi.fn(),
}));

vi.mock("../resources/McpIntegrationDialog.js", () => ({
  McpIntegrationDialog: () => null,
}));

vi.mock("../resources/McpServerDetail.js", () => ({
  McpServerDetail: () => null,
}));

vi.mock("../resources/use-mcp-servers.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../resources/use-mcp-servers.js")>()),
  useCreateMcpServer: mcpMocks.useCreateMcpServer,
  useDeleteMcpServer: mcpMocks.useDeleteMcpServer,
  useMcpServers: mcpMocks.useMcpServers,
}));

vi.mock("../settings/SettingsPanel.js", () => ({
  AgentSettingsContent: () => null,
}));

vi.mock("../i18n.js", () => ({
  useT: () => (key: string) => key,
}));

import { ConnectionsTab } from "./AgentTabsPage.js";

describe("ConnectionsTab load recovery", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mcpMocks.refetch.mockReset();
    mcpMocks.useMcpServers.mockReturnValue({
      data: undefined,
      error: new Error("Unauthorized"),
      isError: true,
      isFetching: false,
      isLoading: false,
      refetch: mcpMocks.refetch,
    });
    mcpMocks.useCreateMcpServer.mockReturnValue({ mutateAsync: vi.fn() });
    mcpMocks.useDeleteMcpServer.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("explains the sign-in requirement and retries without leaving the tab", () => {
    act(() => {
      root.render(<ConnectionsTab />);
    });

    expect(container.textContent).toContain(
      "Sign in to a workspace app, then retry loading agent integrations.",
    );
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry",
    );
    expect(retry).not.toBeUndefined();

    act(() => {
      retry?.click();
    });

    expect(mcpMocks.refetch).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Agent integrations");
  });
});
