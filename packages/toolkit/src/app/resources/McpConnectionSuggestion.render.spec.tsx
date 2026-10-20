// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mcpMocks = vi.hoisted(() => ({
  isMcpServersPending: vi.fn(() => false),
  useCreateMcpServer: vi.fn(),
  useMcpServers: vi.fn(),
}));

vi.mock("../shared/index.js", () => ({
  openAgentSettings: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
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

vi.mock("./McpIntegrationDialogDeferred.js", () => ({
  McpIntegrationDialogDeferred: () => null,
}));

vi.mock("@agent-native/core/client/resources/use-mcp-servers", () => mcpMocks);

import {
  DEFAULT_MCP_INTEGRATIONS,
  type DefaultMcpIntegration,
} from "@agent-native/core/client/resources/mcp-integration-catalog";

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
  let localStorageDescriptor: PropertyDescriptor | undefined;

  function createMemoryStorage(): Storage {
    const values = new Map<string, string>();
    return {
      get length() {
        return values.size;
      },
      clear() {
        values.clear();
      },
      getItem(key) {
        return values.get(key) ?? null;
      },
      key(index) {
        return [...values.keys()][index] ?? null;
      },
      removeItem(key) {
        values.delete(key);
      },
      setItem(key, value) {
        values.set(String(key), String(value));
      },
    };
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    localStorageDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "localStorage",
    );
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createMemoryStorage(),
    });
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
    if (localStorageDescriptor) {
      Object.defineProperty(window, "localStorage", localStorageDescriptor);
    } else {
      Reflect.deleteProperty(window, "localStorage");
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function renderSuggestion() {
    act(() => {
      root.render(
        <McpConnectionSuggestion
          text="Connect Notion"
          requestedByAgent
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
    const dismissals = JSON.parse(
      window.localStorage.getItem(
        "agent-native:mcp-connection-suggestions-dismissed",
      ) ?? "{}",
    ) as Record<string, number>;
    expect(dismissals["test-integration"]).toEqual(expect.any(Number));

    act(() => root.unmount());
    root = createRoot(container);
    renderSuggestion();
    expect(container.querySelector("[data-mcp-connection-suggestion]")).toBe(
      null,
    );
  });

  it("shows a dismissed suggestion again after one week", () => {
    vi.useFakeTimers();
    const dismissedAt = new Date("2026-10-01T00:00:00.000Z").getTime();
    vi.setSystemTime(dismissedAt);
    window.localStorage.setItem(
      "agent-native:mcp-connection-suggestions-dismissed",
      JSON.stringify({ "test-integration": dismissedAt }),
    );

    renderSuggestion();

    expect(container.querySelector("[data-mcp-connection-suggestion]")).toBe(
      null,
    );

    act(() => vi.advanceTimersByTime(7 * 24 * 60 * 60 * 1000));

    expect(
      container.querySelector("[data-mcp-connection-suggestion]"),
    ).not.toBeNull();
  });

  it("migrates existing dismissal IDs and preserves them across mounts", () => {
    vi.useFakeTimers();
    const dismissedAt = new Date("2026-10-01T00:00:00.000Z").getTime();
    vi.setSystemTime(dismissedAt);
    window.localStorage.setItem(
      "agent-native:mcp-connection-suggestions-dismissed",
      JSON.stringify(["test-integration"]),
    );

    renderSuggestion();

    expect(container.querySelector("[data-mcp-connection-suggestion]")).toBe(
      null,
    );
    expect(
      JSON.parse(
        window.localStorage.getItem(
          "agent-native:mcp-connection-suggestions-dismissed",
        ) ?? "{}",
      ),
    ).toEqual({ "test-integration": dismissedAt });

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

  it("recognizes a URL-less catalog preset by its connected provider host", () => {
    const sigma = DEFAULT_MCP_INTEGRATIONS.find(
      (candidate) => candidate.id === "sigma",
    )!;
    mcpMocks.useMcpServers.mockReturnValue({
      data: {
        user: [
          {
            url: "https://acme.sigmacomputing.com/mcp",
            status: { state: "connected" },
          },
        ],
        org: [],
      },
      isSuccess: true,
    });

    act(() => {
      root.render(
        <McpConnectionSuggestion text="Connect Sigma" integrations={[sigma]} />,
      );
    });

    expect(container.querySelector("[data-mcp-connection-suggestion]")).toBe(
      null,
    );
  });
});
