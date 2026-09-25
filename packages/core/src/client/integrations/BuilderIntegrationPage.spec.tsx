// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import englishMessages from "../../localization/core-messages/en-US.js";
import type { SettingsShellContextValue } from "../settings/shell/context.js";
import type { SettingsPageContext } from "../settings/shell/registry.js";
import type { BuilderConnectFlow } from "../settings/useBuilderStatus.js";

const flowMock = vi.hoisted(() => ({
  current: null as unknown as BuilderConnectFlow,
}));
const disconnectMock = vi.hoisted(() => vi.fn());
const actionMocks = vi.hoisted(() => ({
  useActionQuery: vi.fn(),
  callAction: vi.fn(),
  useActionMutation: vi.fn(),
  actionErrorMessage: (error: unknown) =>
    (error as { actionMessage?: string } | undefined)?.actionMessage,
}));

vi.mock("../settings/useBuilderStatus.js", () => ({
  useBuilderConnectFlow: () => flowMock.current,
}));
vi.mock("../use-action.js", () => actionMocks);
vi.mock("../org/hooks.js", () => ({
  useOrg: () => ({ data: { orgName: "Acme" } }),
}));
vi.mock("../settings/deferred-builder-connect-popover.js", () => ({
  DeferredBuilderConnectPopover: ({
    children,
    onConnect,
  }: {
    children: React.ReactElement<{ onClick?: () => void }>;
    onConnect: (provisionAccount: boolean) => void;
  }) => React.cloneElement(children, { onClick: () => onConnect(false) }),
}));
vi.mock("../i18n.js", () => ({
  useT:
    () =>
    (key: string, options?: Record<string, unknown>): string => {
      const messages = englishMessages as Record<string, string>;
      const message =
        messages[key.replace(/^agentChat\./, "")] ??
        (key === "common.cancel" ? "Cancel" : key);
      return message.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(options?.[name] ?? ""),
      );
    },
}));

import { SettingsShellProvider } from "../settings/shell/context.js";
import { BuilderIntegrationPage } from "./BuilderIntegrationPage.js";

function flow(overrides: Partial<BuilderConnectFlow> = {}): BuilderConnectFlow {
  return {
    configured: false,
    statusResolved: true,
    statusReadSettledCount: 1,
    envManaged: false,
    credentialSource: null,
    canDisconnect: false,
    grants: {},
    effective: null,
    canConnect: { org: false, personal: true },
    agentNativeProvisioningEnabled: false,
    codeChangeConfigured: false,
    builderEnabled: true,
    orgName: null,
    connecting: false,
    error: null,
    accountExists: false,
    hasFetchedStatus: true,
    start: vi.fn(),
    cancel: vi.fn(),
    retry: vi.fn(() => true),
    ...overrides,
  } as BuilderConnectFlow;
}

const member: SettingsPageContext = {
  role: "member",
  isOwner: false,
  isAdmin: false,
  hasOrganization: true,
  appId: "clips",
  labs: {},
  flags: {},
};
const admin: SettingsPageContext = {
  ...member,
  role: "admin",
  isAdmin: true,
};

describe("BuilderIntegrationPage", () => {
  let container: HTMLDivElement;
  let root: Root;
  let defaultModel: unknown;

  function render(context: SettingsPageContext) {
    const shell: SettingsShellContextValue = {
      route: { page: "integrations", sub: "builder" },
      navigate: vi.fn(),
      setHeader: vi.fn(),
    };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <SettingsShellProvider value={shell}>
            <BuilderIntegrationPage context={context} />
          </SettingsShellProvider>
        </QueryClientProvider>,
      );
      // Let the services read settle.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  const row = (id: string) => container.querySelector(`#${id}`);
  const button = (text: string, scope: ParentNode = container) =>
    Array.from(scope.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === text,
    );

  async function openMenu(scope: string) {
    const trigger = container.querySelector<HTMLButtonElement>(
      `[data-builder-manage="${scope}"]`,
    );
    await act(async () => {
      trigger?.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          button: 0,
          cancelable: true,
        }),
      );
      trigger?.click();
    });
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    disconnectMock.mockReset();
    disconnectMock.mockResolvedValue({ disconnected: "org" });
    actionMocks.useActionMutation.mockReturnValue({
      mutateAsync: disconnectMock,
    });
    actionMocks.useActionQuery.mockReturnValue({
      data: { activeProvider: { id: "builder", name: "Builder.io" } },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    defaultModel = { status: "elsewhere" };
    actionMocks.callAction.mockImplementation(async (name: string) =>
      name === "manage-builder-connection"
        ? {
            grants: {},
            canConnect: { org: true, personal: false },
            defaultModel,
          }
        : {
            canManage: false,
            services: [
              {
                service: "voice",
                provider: null,
                effectiveProvider: "builder",
                options: [],
              },
              {
                service: "images",
                provider: "gemini",
                effectiveProvider: "gemini",
                options: [],
              },
            ],
            updatedAt: null,
            updatedBy: null,
          },
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("offers a member their own connection and no organization control", async () => {
    flowMock.current = flow();
    await render(member);

    expect(row("builder-organization")?.textContent).toContain(
      "Not connected. An owner or admin can connect it.",
    );
    expect(button("Connect", row("builder-organization")!)).toBeUndefined();
    expect(row("builder-personal")?.textContent).toContain(
      "Connect your own account. Only you use it.",
    );

    await act(async () => button("Connect", row("builder-personal")!)?.click());
    expect(flowMock.current.start).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "personal", provisionAccount: false }),
    );
  });

  it("tells a member their connection is unused while personal keys are restricted", async () => {
    flowMock.current = flow({
      grants: {
        personal: { connectedAt: 1, needsReconnect: false, restricted: true },
      },
      canConnect: { org: false, personal: false },
    });
    await render(member);

    expect(row("builder-personal")?.textContent).toContain(
      "Not used while personal API keys are restricted.",
    );
  });

  it("says who restricted it when a member has no connection to fall back on", async () => {
    flowMock.current = flow({ canConnect: { org: false, personal: false } });
    await render(member);

    expect(row("builder-personal")?.textContent).toContain(
      "Owners and admins restricted personal API keys.",
    );
    expect(button("Connect", row("builder-personal")!)).toBeUndefined();
  });

  it("gives an admin the organization connect and no personal row", async () => {
    flowMock.current = flow({ canConnect: { org: true, personal: false } });
    await render(admin);

    expect(row("builder-organization")?.textContent).toContain(
      "Not connected. When you connect it, everyone in Acme can use it.",
    );
    expect(row("builder-personal")).toBeNull();
    await act(async () =>
      button("Connect", row("builder-organization")!)?.click(),
    );
    expect(flowMock.current.start).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "org" }),
    );
  });

  it("shows an admin's existing personal keys so they can remove them", async () => {
    flowMock.current = flow({
      configured: true,
      effective: "personal",
      grants: {
        personal: { connectedAt: 1, needsReconnect: false, restricted: false },
      },
      canConnect: { org: true, personal: false },
    });
    await render(admin);

    expect(row("builder-personal")).not.toBeNull();
    expect(
      container.querySelector('[data-builder-manage="personal"]'),
    ).not.toBeNull();
    await openMenu("personal");
    const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "Disconnect",
    ]);
  });

  it("confirms an organization disconnect with what stops working", async () => {
    flowMock.current = flow({
      configured: true,
      effective: "org",
      orgName: "Builder space",
      grants: { org: { connectedAt: 1, needsReconnect: false } },
      canConnect: { org: true, personal: false },
    });
    await render(admin);

    expect(row("builder-organization")?.textContent).toContain(
      "Connected · Builder space",
    );
    // Used for: storage and voice run on Builder.io; images use Gemini.
    await vi.waitFor(() =>
      expect(row("used-for")?.textContent).toContain("Voice input"),
    );
    const usedFor = row("used-for");
    expect(usedFor?.textContent).toContain("File uploads and storage");
    expect(usedFor?.textContent).toContain("Voice input");
    expect(usedFor?.textContent).not.toContain("Image generation");
    expect(usedFor?.textContent).toContain("Browser automation");
    expect(container.textContent).toContain(
      "Choose what runs on Builder.io in Infrastructure.",
    );

    await openMenu("org");
    const disconnectItem = Array.from(
      document.querySelectorAll('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("Disconnect"));
    await act(async () => {
      disconnectItem?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Disconnect Builder.io?");
    expect(dialog?.textContent).toContain(
      "This affects everyone in Acme who hasn't connected their own account.",
    );
    const effects = dialog?.querySelector("[data-builder-disconnect-effects]");
    expect(effects?.textContent).toContain(
      "Uploads fail until you set up storage.",
    );
    expect(effects?.textContent).toContain(
      "Stops until another provider is set up.",
    );
    expect(effects?.textContent).toContain(
      "Builder.io models leave the model picker.",
    );
    expect(disconnectMock).not.toHaveBeenCalled();

    await act(async () => button("Disconnect", dialog!)?.click());
    expect(disconnectMock).toHaveBeenCalledWith({ disconnect: "org" });
  });

  async function openOrgDisconnect() {
    await openMenu("org");
    const disconnectItem = Array.from(
      document.querySelectorAll('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("Disconnect"));
    await act(async () => {
      disconnectItem?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    return document.querySelector('[role="alertdialog"]');
  }

  const orgConnected = () =>
    flow({
      configured: true,
      effective: "org",
      grants: { org: { connectedAt: 1, needsReconnect: false } },
      canConnect: { org: true, personal: false },
    });

  it("says the default model switches when it runs on Builder.io", async () => {
    defaultModel = {
      status: "builder",
      model: "claude-sonnet-4-5",
      whenDisconnected: { status: "switches", next: "Anthropic" },
    };
    flowMock.current = orgConnected();
    await render(admin);

    await vi.waitFor(() =>
      expect(row("builder-use-ai-model")?.textContent).toContain(
        "The default model, claude-sonnet-4-5 · Builder.io.",
      ),
    );
    const dialog = await openOrgDisconnect();
    const effects = dialog?.querySelector("[data-builder-disconnect-effects]");
    expect(effects?.textContent).toContain(
      "The default model switches to Anthropic.",
    );
    expect(effects?.textContent).not.toContain("leave the model picker");
  });

  it("says chats stop when no organization provider can take over the default", async () => {
    defaultModel = {
      status: "builder",
      model: "claude-sonnet-4-5",
      whenDisconnected: { status: "stops" },
    };
    flowMock.current = orgConnected();
    await render(admin);

    await vi.waitFor(() =>
      expect(row("builder-use-ai-model")?.textContent).toContain(
        "The default model, claude-sonnet-4-5 · Builder.io.",
      ),
    );
    const dialog = await openOrgDisconnect();
    expect(dialog?.textContent).toContain(
      "Chats stop until you add an organization provider.",
    );
  });

  it("flags an unreadable default model instead of claiming it's elsewhere", async () => {
    defaultModel = { status: "unknown", error: "settings store down" };
    flowMock.current = orgConnected();
    await render(admin);

    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')).not.toBeNull(),
    );
  });

  it("keeps the dialog open and shows the error when a disconnect fails", async () => {
    disconnectMock.mockRejectedValue(
      Object.assign(new Error("Action manage-builder-connection failed"), {
        actionMessage: "Store unavailable",
      }),
    );
    flowMock.current = flow({
      configured: true,
      effective: "org",
      grants: { org: { connectedAt: 1, needsReconnect: false } },
      canConnect: { org: true, personal: false },
    });
    await render(admin);

    await openMenu("org");
    const disconnectItem = Array.from(
      document.querySelectorAll('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("Disconnect"));
    await act(async () => {
      disconnectItem?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    const dialog = document.querySelector('[role="alertdialog"]');
    await act(async () => button("Disconnect", dialog!)?.click());

    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Store unavailable");
  });

  it("disconnects a member's own connection without a confirm", async () => {
    flowMock.current = flow({
      configured: true,
      effective: "personal",
      grants: {
        personal: { connectedAt: 1, needsReconnect: false, restricted: false },
      },
    });
    await render(member);

    expect(row("builder-personal")?.textContent).toContain(
      "Connected. Only you use it.",
    );
    await openMenu("personal");
    const disconnectItem = Array.from(
      document.querySelectorAll('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("Disconnect"));
    await act(async () => {
      disconnectItem?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(disconnectMock).toHaveBeenCalledWith({ disconnect: "personal" });
    // Members don't get the Infrastructure footnote.
    expect(container.textContent).not.toContain("Choose what runs on");
  });

  it("says the connections couldn't be read instead of showing Not connected", async () => {
    flowMock.current = flow({ grants: null });
    await render(member);

    expect(container.textContent).toContain(
      "Couldn't read the Builder.io connections.",
    );
    expect(container.textContent).not.toContain("Not connected");
  });
});
