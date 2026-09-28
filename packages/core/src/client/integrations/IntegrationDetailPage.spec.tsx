// @vitest-environment happy-dom

import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import englishMessages from "../../localization/core-messages/en-US.js";
import type { SettingsShellContextValue } from "../settings/shell/context.js";
import type { SettingsPageContext } from "../settings/shell/registry.js";

const mcpMocks = vi.hoisted(() => ({
  isMcpServersPending: vi.fn(() => false),
  useCreateMcpServer: vi.fn(),
  useDeleteMcpServer: vi.fn(),
  useMcpServers: vi.fn(),
  useReconnectMcpServer: vi.fn(),
  formatMcpServerError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));
const dialogMocks = vi.hoisted(() => ({
  McpIntegrationDialog: vi.fn(() => null),
}));
const agent = vi.hoisted(() => ({ submitToAgent: vi.fn() }));
const keys = vi.hoisted(() => ({ saveApiKeyValue: vi.fn() }));
const oauth = vi.hoisted(() => ({
  navigateToMcpOAuthStart: vi.fn(() => true),
}));

vi.mock("../resources/use-mcp-servers.js", () => mcpMocks);
vi.mock("../resources/McpIntegrationDialog.js", () => dialogMocks);
vi.mock("../CommandMenu.js", () => agent);
vi.mock("../settings/api-keys/api-keys-client.js", () => keys);
vi.mock("../org/hooks.js", () => ({
  useOrg: () => ({ data: { orgName: "Acme" } }),
}));
vi.mock("./useIntegrationStatus.js", () => ({
  useIntegrationStatus: () => ({ statuses: [], loading: false, refetch() {} }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../resources/mcp-integration-catalog.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../resources/mcp-integration-catalog.js")
  >()),
  navigateToMcpOAuthStart: oauth.navigateToMcpOAuthStart,
}));

vi.mock("../i18n.js", () => ({
  useT:
    () =>
    (key: string, options?: Record<string, unknown>): string => {
      const messages = englishMessages as Record<string, string>;
      const fallback: Record<string, string> = {
        "mcpIntegrations.connect": "Connect",
        "mcpIntegrations.connecting": "Connecting…",
        "mcpIntegrations.connected": "Connected",
        "mcpIntegrations.personal": "Personal",
        "mcpIntegrations.auth.oauth": "OAuth",
        "mcpIntegrations.status.beta": "Beta",
        "mcpIntegrations.viewSetup": "Open setup guide",
        "mcpIntegrations.toolsAvailable": "{{count}} tools available",
      };
      const message =
        messages[key.replace(/^agentChat\./, "")] ??
        fallback[key] ??
        (options?.defaultValue as string | undefined) ??
        key;
      return message.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(options?.[name] ?? ""),
      );
    },
}));

import { SettingsShellProvider } from "../settings/shell/context.js";
import { IntegrationDetailPage } from "./IntegrationDetailPage.js";

const OWNER: SettingsPageContext = {
  role: "owner",
  isOwner: true,
  isAdmin: true,
  hasOrganization: true,
  soloDeploymentAdmin: false,
  appId: "clips",
  labs: {},
  flags: {},
};
const MEMBER: SettingsPageContext = {
  ...OWNER,
  role: "member",
  isOwner: false,
  isAdmin: false,
};

describe("IntegrationDetailPage", () => {
  let container: HTMLDivElement;
  let headerContainer: HTMLDivElement;
  let root: Root;
  let headerRoot: Root;
  let navigate: ReturnType<typeof vi.fn>;
  let setHeader: ReturnType<typeof vi.fn>;
  let createServer: ReturnType<typeof vi.fn>;

  function Providers({ children }: { children: ReactNode }) {
    const shell: SettingsShellContextValue = {
      route: { page: "integrations", sub: null },
      navigate: navigate as SettingsShellContextValue["navigate"],
      setHeader: setHeader as SettingsShellContextValue["setHeader"],
    };
    return (
      <SettingsShellProvider value={shell}>{children}</SettingsShellProvider>
    );
  }

  async function render(id: string, context = OWNER) {
    await act(async () => {
      root.render(
        <Providers>
          <IntegrationDetailPage id={id} appName="Clips" context={context} />
        </Providers>,
      );
    });
  }

  function lastHeader() {
    return setHeader.mock.calls.at(-1)?.[0] as
      | { title?: ReactNode; action?: ReactNode }
      | null
      | undefined;
  }

  /** Render what the page handed the shell's header. */
  async function renderHeader() {
    const header = lastHeader();
    await act(async () => {
      headerRoot.render(
        <Providers>
          <span data-title="">{header?.title}</span>
          {header?.action ?? null}
        </Providers>,
      );
    });
    return {
      title: headerContainer.querySelector("[data-title]"),
      action: headerContainer.querySelector("button"),
    };
  }

  const rowText = (id: string) =>
    container.querySelector(`[id="${id}"]`)?.textContent ?? "";

  const typeInto = (input: HTMLInputElement, value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

  function servers(user: unknown[] = [], role: "owner" | "member" = "owner") {
    mcpMocks.useMcpServers.mockReturnValue({
      data: { user, org: [], orgId: "acme", role },
      isError: false,
      isSuccess: true,
      isLoading: false,
    });
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    headerContainer = document.createElement("div");
    document.body.append(container, headerContainer);
    root = createRoot(container);
    headerRoot = createRoot(headerContainer);
    navigate = vi.fn();
    setHeader = vi.fn();
    createServer = vi.fn().mockResolvedValue(undefined);
    servers();
    mcpMocks.useCreateMcpServer.mockReturnValue({ mutateAsync: createServer });
    mcpMocks.useDeleteMcpServer.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    });
    mcpMocks.useReconnectMcpServer.mockReturnValue({ mutateAsync: vi.fn() });
    keys.saveApiKeyValue.mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    act(() => headerRoot.unmount());
    container.remove();
    headerContainer.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders Figma like the prototype: logo breadcrumb, prompts, callout, and both groups", async () => {
    await render("figma");

    const { title, action } = await renderHeader();
    expect(title?.textContent).toBe("Figma");
    expect(title?.querySelector("img")?.getAttribute("src")).toMatch(
      /^data:image\//,
    );
    expect(action?.textContent).toBe("Add access token");

    const prompts = Array.from(
      container.querySelectorAll("[data-integration-hero] button"),
      (button) => button.textContent,
    );
    expect(prompts).toEqual([
      "FigmaSummarize the components in this Figma file",
      "FigmaList the color variables in our design system",
      "FigmaDescribe the layout of this frame",
    ]);
    expect(container.textContent).toContain(
      "The agent uses the access token you add, so it sees what that token can see.",
    );
    expect(
      container.querySelector("[data-integration-callout]")?.textContent,
    ).toContain("Connects with an access token");
    expect(rowText("who-can-use-it")).toContain(
      "Each person connects their own account.",
    );
    expect(rowText("sign-in")).toContain("Access token");
    expect(rowText("developer")).toContain("Figma");
    expect(rowText("category")).toContain("Design");
    // The token goes to Figma's REST API, not the restricted server.
    expect(container.querySelector('[id="server-url"]')).toBeNull();
    expect(
      container.querySelector('[id="documentation"] a')?.getAttribute("href"),
    ).toBe("https://developers.figma.com/docs/figma-mcp-server/");
  });

  it("asks the agent when a prompt is clicked", async () => {
    await render("linear");
    const prompt = Array.from(
      container.querySelectorAll("[data-integration-hero] button"),
    ).find((button) =>
      button.textContent?.includes("What's left in the current cycle?"),
    ) as HTMLButtonElement;
    await act(async () => prompt.click());
    expect(agent.submitToAgent).toHaveBeenCalledWith(
      "What's left in the current cycle?",
    );
  });

  it("saves Figma's token as its API key, in a dialog on the page", async () => {
    await render("figma");
    const { action } = await renderHeader();
    await act(async () => action?.click());

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Connect Figma");
    expect(dialog?.textContent).toContain(
      "Create a personal access token in Figma, then paste it here.",
    );
    const submit = dialog?.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    expect(submit?.disabled).toBe(true);
    await typeInto(
      dialog!.querySelector<HTMLInputElement>('input[type="password"]')!,
      "fake-figma-token",
    );
    await act(async () => submit?.click());

    expect(keys.saveApiKeyValue).toHaveBeenCalledWith({
      name: "FIGMA_ACCESS_TOKEN",
      value: "fake-figma-token",
      registered: true,
    });
    expect(createServer).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("connects a header integration with the token in its header", async () => {
    await render("github");
    const { action } = await renderHeader();
    await act(async () => action?.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    await typeInto(
      dialog.querySelector<HTMLInputElement>('input[type="password"]')!,
      "fake-gh-token",
    );
    await act(async () =>
      dialog.querySelector<HTMLButtonElement>('button[type="submit"]')?.click(),
    );
    expect(createServer).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "user",
        name: "GitHub",
        url: "https://api.githubcopilot.com/mcp/",
        headers: { Authorization: "Bearer fake-gh-token" },
      }),
    );
  });

  it("starts OAuth in a popup from Connect, without navigating away", async () => {
    await render("linear");
    const { action } = await renderHeader();
    expect(action?.textContent).toBe("Connect");
    await act(async () => action?.click());

    expect(oauth.navigateToMcpOAuthStart).toHaveBeenCalledTimes(1);
    const url = new URL(
      oauth.navigateToMcpOAuthStart.mock.calls[0]![0] as string,
      "http://localhost",
    );
    expect(url.searchParams.get("url")).toBe("https://mcp.linear.app/mcp");
    expect(url.searchParams.get("scope")).toBe("user");
    expect(navigate).not.toHaveBeenCalled();
    expect(rowText("sign-in")).toContain("OAuth");
  });

  it("lets an admin share a public server with the organization", async () => {
    await render("context7");
    expect(rowText("who-can-use-it")).toContain(
      "A shared connection lets everyone in Acme use your access.",
    );
    const shared = Array.from(
      container.querySelectorAll<HTMLButtonElement>("#who-can-use-it button"),
    ).find((button) => button.textContent === "Acme");
    await act(async () => shared?.click());
    const { action } = await renderHeader();
    await act(async () => action?.click());
    expect(createServer).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "org",
        url: "https://mcp.context7.com/mcp",
      }),
    );
  });

  it("locks sharing for members", async () => {
    servers([], "member");
    await render("context7", MEMBER);
    expect(rowText("who-can-use-it")).toContain(
      "Only owners and admins can share it with Acme.",
    );
    expect(
      container.querySelector("#who-can-use-it svg.tabler-icon-lock"),
    ).not.toBeNull();
  });

  it("offers nothing to connect when the provider hasn't approved the client", async () => {
    await render("vercel");
    expect(lastHeader()?.action).toBeNull();
    expect(
      container.querySelector("[data-integration-callout]")?.textContent,
    ).toContain("Not available yet");
    expect(container.querySelector('[id="server-url"]')).toBeNull();
  });

  it("tells members an admin has to set up a workspace OAuth app", async () => {
    servers([], "member");
    await render("asana", MEMBER);
    expect(lastHeader()?.action).toBeNull();
    const callout = container.querySelector("[data-integration-callout]");
    expect(callout?.textContent).toContain("An admin needs to set this up");
    expect(callout?.textContent).toContain(
      "Ask an owner or admin in Acme to add Asana's client ID and secret.",
    );
  });

  it("opens provider setup in a modal for admins", async () => {
    await render("asana");
    const { action } = await renderHeader();
    expect(action?.textContent).toBe("Set up");
    await act(async () => action?.click());
    const props = (
      dialogMocks.McpIntegrationDialog.mock.calls.at(-1) as unknown[]
    )[0] as Record<string, unknown>;
    expect(props.open).toBe(true);
    expect(props.presentation).toBe("modal");
    expect(props.initialIntegrationId).toBe("asana");
  });

  it("shows a connection instead of Connect once connected", async () => {
    servers([
      {
        id: "linear",
        scope: "user",
        name: "Linear",
        url: "https://mcp.linear.app/mcp",
        authMode: "oauth",
        createdAt: 1,
        mergedId: "user:linear",
        status: { state: "connected", toolCount: 12 },
      },
    ]);
    await render("linear");
    expect(lastHeader()?.action).toBeNull();
    const row = container.querySelector(
      "#connection .agent-native-settings-row",
    );
    expect(row?.textContent).toContain("Connected");
    expect(row?.textContent).toContain("Personal · 12 tools available");
    expect(row?.querySelector("button")?.textContent).toBe("Remove");
  });

  it("marks a beta integration", async () => {
    await render("grafana");
    expect(rowText("status")).toContain("Beta");
  });

  it("keeps the breadcrumb on an id that isn't in the catalog", async () => {
    await render("not-a-real-integration");
    expect(lastHeader()?.title).toBe("Not found");
    expect(
      container.querySelector("[data-integration-not-found]")?.textContent,
    ).toBe("This integration isn't in the catalog.");
  });

  it("sends an old Integrations link for a channel to Channels", async () => {
    await render("telegram");
    expect(navigate).toHaveBeenCalledWith("channels", "telegram", {
      replace: true,
    });
    await render("google-workspace");
    expect(navigate).toHaveBeenCalledWith("channels", "google-docs", {
      replace: true,
    });
  });
});
