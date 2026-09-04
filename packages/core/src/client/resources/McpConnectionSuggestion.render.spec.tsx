// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mcpMocks = vi.hoisted(() => ({
  useCreateMcpServer: vi.fn(),
  useMcpServers: vi.fn(),
}));

vi.mock("../CommandMenu.js", () => ({
  openAgentSettings: vi.fn(),
}));

vi.mock("../i18n.js", () => ({
  useT: () => (key: string, options?: { name?: string }) => {
    if (key === "mcpIntegrations.connectSuggestion") {
      return `Connect ${options?.name ?? "integration"}`;
    }
    if (key === "mcpIntegrations.connect") return "Connect";
    if (key === "mcpIntegrations.dismissSuggestion") {
      return "Dismiss suggestion";
    }
    return key;
  },
}));

vi.mock("./McpIntegrationDialog.js", () => ({
  McpIntegrationDialog: () => null,
}));

vi.mock("./use-mcp-servers.js", () => mcpMocks);

import type { DefaultMcpIntegration } from "./mcp-integration-catalog.js";
import { McpConnectionSuggestion } from "./McpConnectionSuggestion.js";

const integration = {
  id: "test-integration",
  name: "Notion",
  provider: "notion",
  description: "Search Notion pages.",
  descriptionKey: "mcpIntegrations.catalog.notion.description",
  useCase: "knowledge search",
  useCaseKey: "mcpIntegrations.catalog.notion.useCase",
  url: "https://mcp.example.com/notion",
  authMode: "oauth",
  connectionMode: "oauth",
  availability: "ready",
  verification: "verified",
  logoUrl: "",
  keywords: ["Notion"],
} satisfies DefaultMcpIntegration;

describe("McpConnectionSuggestion render", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mcpMocks.useCreateMcpServer.mockReturnValue({
      mutateAsync: vi.fn(),
    });
    mcpMocks.useMcpServers.mockReturnValue({
      data: { user: [], org: [] },
      isSuccess: true,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function renderSuggestion() {
    act(() => {
      root.render(
        <McpConnectionSuggestion
          text="Connect Notion"
          integrations={[integration]}
        />,
      );
    });
  }

  it("persists an X dismissal across mounts", () => {
    renderSuggestion();
    const dismiss = container.querySelector(
      'button[aria-label="Dismiss suggestion"]',
    );
    expect(dismiss).not.toBeNull();

    act(() => (dismiss as HTMLButtonElement).click());

    expect(container.querySelector("[data-mcp-connection-suggestion]")).toBe(
      null,
    );
    expect(
      JSON.parse(
        window.localStorage.getItem(
          "agent-native:mcp-connection-suggestions-dismissed",
        ) ?? "[]",
      ),
    ).toEqual(["test-integration"]);

    act(() => root.unmount());
    root = createRoot(container);
    renderSuggestion();
    expect(container.querySelector("[data-mcp-connection-suggestion]")).toBe(
      null,
    );
  });

  it("does not suggest an integration that is already connected", () => {
    mcpMocks.useMcpServers.mockReturnValue({
      data: {
        user: [
          {
            url: integration.url,
            status: { state: "connected" },
          },
        ],
        org: [],
      },
      isSuccess: true,
    });

    renderSuggestion();

    expect(container.querySelector("[data-mcp-connection-suggestion]")).toBe(
      null,
    );
  });
});
