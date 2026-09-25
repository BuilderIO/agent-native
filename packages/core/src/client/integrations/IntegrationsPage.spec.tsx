// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import englishMessages from "../../localization/core-messages/en-US.js";
import type { SettingsShellContextValue } from "../settings/shell/context.js";

const mcpMocks = vi.hoisted(() => ({
  isMcpServersPending: vi.fn(() => false),
  useCreateMcpServer: vi.fn(),
  useDeleteMcpServer: vi.fn(),
  useMcpServers: vi.fn(),
  useReconnectMcpServer: vi.fn(),
}));

const builderMocks = vi.hoisted(() => ({
  useBuilderStatus: vi.fn(),
}));

const dialogMocks = vi.hoisted(() => ({
  McpIntegrationDialog: vi.fn(() => null),
}));

vi.mock("../resources/McpIntegrationDialog.js", () => dialogMocks);
vi.mock("../resources/use-mcp-servers.js", () => mcpMocks);
vi.mock("../settings/useBuilderStatus.js", () => builderMocks);
vi.mock("./useIntegrationStatus.js", () => ({
  useIntegrationStatus: () => ({ statuses: [], loading: false, refetch() {} }),
}));

vi.mock("../i18n.js", () => ({
  useT:
    () =>
    (key: string, options?: Record<string, unknown>): string => {
      const messages = englishMessages as Record<string, string>;
      const message =
        messages[key.replace(/^agentChat\./, "")] ??
        (key === "mcpIntegrations.searchPlaceholder"
          ? "Search integrations"
          : key);
      return message.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(options?.[name] ?? ""),
      );
    },
}));

import { SettingsShellProvider } from "../settings/shell/context.js";
import { IntegrationsPage } from "./IntegrationsPage.js";

describe("IntegrationsPage", () => {
  let container: HTMLDivElement;
  let root: Root;
  let navigate: ReturnType<typeof vi.fn>;
  let setHeader: ReturnType<typeof vi.fn>;

  function render(sub: string | null = null) {
    const shell: SettingsShellContextValue = {
      route: { page: "integrations", sub },
      navigate: navigate as SettingsShellContextValue["navigate"],
      setHeader: setHeader as SettingsShellContextValue["setHeader"],
    };
    return act(async () => {
      root.render(
        <SettingsShellProvider value={shell}>
          <IntegrationsPage sub={sub} appName="Clips" />
        </SettingsShellProvider>,
      );
    });
  }

  function typeQuery(value: string) {
    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search integrations"]',
    );
    return act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(search, value);
      search?.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  const headings = () =>
    Array.from(container.querySelectorAll("h2")).map((h) => h.textContent);

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.history.replaceState({}, "", "/settings/integrations");
    navigate = vi.fn();
    setHeader = vi.fn();
    mcpMocks.useMcpServers.mockReturnValue({
      data: { user: [], org: [], orgId: "acme", role: "member" },
      isError: false,
      isLoading: false,
    });
    mcpMocks.useCreateMcpServer.mockReturnValue({ mutateAsync: vi.fn() });
    mcpMocks.useDeleteMcpServer.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    });
    mcpMocks.useReconnectMcpServer.mockReturnValue({ mutateAsync: vi.fn() });
    builderMocks.useBuilderStatus.mockReturnValue({
      status: { configured: false },
      loading: false,
      error: null,
      stale: false,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("recommends Builder.io first until it's connected", async () => {
    await render();

    expect(headings()[0]).toBe("Recommended");
    const builder = container.querySelector(
      'button[aria-label="Connect Builder.io"]',
    );
    expect(builder).not.toBeNull();
    await act(async () => (builder as HTMLButtonElement).click());
    expect(navigate).toHaveBeenCalledWith("integrations", "builder");
  });

  it("moves Builder.io to Connected and drops the Recommended badge once connected", async () => {
    builderMocks.useBuilderStatus.mockReturnValue({
      status: { configured: true },
      loading: false,
      error: null,
      stale: false,
      refetch: vi.fn(),
    });
    await render();

    expect(headings()).not.toContain("Recommended");
    expect(headings()[0]).toBe("Connected");
    expect(
      container.querySelector('[data-integration-tile="Builder.io"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Connect Builder.io"]'),
    ).toBeNull();
  });

  it("shows a skeleton, not a guess, while the Builder.io status loads", async () => {
    builderMocks.useBuilderStatus.mockReturnValue({
      status: null,
      loading: true,
      error: null,
      stale: false,
      refetch: vi.fn(),
    });
    await render();

    expect(headings()).not.toContain("Recommended");
    expect(headings()).not.toContain("Connected");
    expect(
      container.querySelector('[data-integration-tile="Builder.io"]'),
    ).toBeNull();
  });

  it("groups the catalog by category, four tiles each, then See more", async () => {
    await render();

    expect(headings()).toEqual(
      expect.arrayContaining([
        "Engineering",
        "Design",
        "Productivity",
        "Sales",
        "Support",
        "Analytics",
        "Finance",
      ]),
    );
    const engineering = container.querySelector("#integrations-engineering");
    expect(
      engineering?.querySelectorAll("[data-integration-tile]"),
    ).toHaveLength(4);
    const seeMore = Array.from(
      engineering?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent?.startsWith("See "));
    expect(seeMore?.textContent).toMatch(/^See .+, .+, and more$/);
    await act(async () => seeMore?.click());
    expect(
      engineering?.querySelectorAll("[data-integration-tile]").length,
    ).toBeGreaterThan(4);
  });

  it("has no messaging channels, Email row, or Builder Publish entry", async () => {
    await render();

    const text = container.textContent ?? "";
    expect(text).not.toContain("Telegram");
    expect(text).not.toContain("WhatsApp");
    expect(text).not.toContain("Google Docs");
    expect(text).not.toContain("agent in channels");
    expect(text).not.toContain("Resend or SendGrid");
    expect(text).not.toContain("Builder.io Publish");
    // Slack's search tools (the MCP integration) stay.
    expect(
      container.querySelector('[data-integration-tile="Slack"]'),
    ).not.toBeNull();
  });

  it("links the footnote to the MCP server page", async () => {
    await render();

    expect(container.textContent).toContain(
      "These are tools the agent uses. To use Clips from Claude, ChatGPT, or Cursor, see MCP server.",
    );
    const link = Array.from(container.querySelectorAll("a")).find(
      (anchor) => anchor.textContent === "MCP server",
    );
    await act(async () => link?.click());
    expect(navigate).toHaveBeenCalledWith("mcp", null);
  });

  it("puts Add custom integration in the page header", async () => {
    await render();

    const header = setHeader.mock.calls.at(-1)?.[0] as {
      action?: React.ReactElement<{ children: React.ReactNode }>;
    } | null;
    expect(header?.action).toBeTruthy();
  });

  it("shows connected servers under Connected", async () => {
    mcpMocks.useMcpServers.mockReturnValue({
      data: {
        user: [
          {
            id: "internal-docs",
            scope: "user",
            name: "Internal docs",
            url: "https://mcp.example.com/mcp",
            authMode: "headers",
            createdAt: 1,
            status: { state: "connected", toolCount: 3 },
          },
        ],
        org: [],
        orgId: "acme",
        role: "member",
      },
      isError: false,
      isLoading: false,
    });
    await render();

    expect(headings()).toEqual(
      expect.arrayContaining(["Recommended", "Connected"]),
    );
    expect(container.textContent).toContain("Internal docs");
  });

  it("filters to matching tiles and says when nothing matches", async () => {
    await render();

    await typeQuery("linear");
    expect(
      container.querySelector('[data-integration-tile="Linear"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-integration-tile="Figma"]'),
    ).toBeNull();

    await typeQuery("zzz-nothing");
    expect(container.textContent).toContain(
      "No integrations match. Try another name.",
    );
  });

  it("opens the integration a search result links to", async () => {
    await render("linear");

    const lastProps = dialogMocks.McpIntegrationDialog.mock.calls
      .map((call) => (call as unknown[])[0] as Record<string, unknown>)
      .filter((props) => props.presentation !== "modal")
      .at(-1);
    expect(lastProps?.open).toBe(true);
    expect(lastProps?.initialIntegrationId).toBe("linear");
  });
});
