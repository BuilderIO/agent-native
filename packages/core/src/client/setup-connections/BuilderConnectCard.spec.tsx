// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BuilderConnectCard } from "./BuilderConnectCard.js";
import type { BuilderConnectCardViewModel } from "./useBuilderConnectCardController.js";

const mocks = vi.hoisted(() => ({
  useBuilderConnectCardController: vi.fn(),
  semanticActionProps: undefined as Record<string, unknown> | undefined,
  semanticStatusProps: undefined as Record<string, unknown> | undefined,
  semanticSurfaceProps: undefined as Record<string, unknown> | undefined,
}));

vi.mock("./useBuilderConnectCardController.js", () => ({
  useBuilderConnectCardController: mocks.useBuilderConnectCardController,
}));

vi.mock("@agent-native/toolkit/design-system", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@agent-native/toolkit/design-system")
    >();
  return {
    ...actual,
    ActionButton: ({ children, onPress, ...props }: any) => {
      mocks.semanticActionProps = props;
      return (
        <button
          data-semantic-action="true"
          disabled={props.disabled}
          onClick={() => onPress?.()}
        >
          {children}
        </button>
      );
    },
    Status: ({ children, ...props }: any) => {
      mocks.semanticStatusProps = props;
      return <span data-semantic-status="true">{children}</span>;
    },
    Surface: ({ children, ...props }: any) => {
      mocks.semanticSurfaceProps = props;
      return <section data-semantic-surface="true">{children}</section>;
    },
  };
});

describe("BuilderConnectCard", () => {
  let container: HTMLDivElement;
  let root: Root;
  let viewModel: BuilderConnectCardViewModel;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    viewModel = {
      title: "Builder connect",
      description:
        "Connect Builder.io for managed model access, browser automation, and workspace identity. Free tier available.",
      status: { kind: "ready", label: "Ready to connect" },
      configured: false,
      pending: false,
      error: null,
      orgName: null,
      action: {
        label: "Connect Builder.io",
        pending: false,
        disabled: false,
        onPress: vi.fn(),
      },
    };
    mocks.useBuilderConnectCardController.mockReturnValue(viewModel);
    mocks.semanticActionProps = undefined;
    mocks.semanticStatusProps = undefined;
    mocks.semanticSurfaceProps = undefined;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the default view and action on the shared controller", () => {
    act(() => root.render(<BuilderConnectCard trackingSource="settings" />));

    expect(mocks.useBuilderConnectCardController).toHaveBeenCalledOnce();
    expect(mocks.useBuilderConnectCardController).toHaveBeenCalledWith(
      expect.objectContaining({ trackingSource: "settings" }),
    );
    expect(container.textContent).toContain("Builder connect");
    expect(container.textContent).toContain("Ready to connect");
    expect(container.querySelector("[data-semantic-action]")).not.toBeNull();
    expect(container.querySelector("[data-semantic-status]")).not.toBeNull();
    expect(container.querySelector("[data-semantic-surface]")).not.toBeNull();
    expect(mocks.semanticSurfaceProps).toMatchObject({
      as: "section",
      elevation: "low",
      padding: "none",
    });
    expect(mocks.semanticStatusProps).toMatchObject({
      tone: "neutral",
      size: "compact",
    });

    act(() => (container.querySelector("button") as HTMLButtonElement).click());
    expect(viewModel.action?.onPress).toHaveBeenCalledOnce();
  });

  it("passes the same view model to a product-concept renderer", () => {
    const render = vi.fn(
      ({ viewModel }: { viewModel: BuilderConnectCardViewModel }) => (
        <article data-custom-card="true">{viewModel.status.label}</article>
      ),
    );

    act(() =>
      root.render(<BuilderConnectCard className="host-card" render={render} />),
    );

    expect(mocks.useBuilderConnectCardController).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledWith({ viewModel, className: "host-card" });
    expect(container.querySelector("[data-custom-card]")?.textContent).toBe(
      "Ready to connect",
    );
  });

  it("uses the semantic action contract for pending state", () => {
    viewModel.pending = true;
    viewModel.action = {
      ...viewModel.action!,
      pending: true,
      disabled: true,
    };

    act(() => root.render(<BuilderConnectCard />));

    expect(container.querySelector("[data-semantic-action]")).not.toBeNull();
    expect(mocks.semanticActionProps).toMatchObject({
      type: "button",
      intent: "primary",
      size: "compact",
      pending: true,
      disabled: true,
    });
    expect(mocks.useBuilderConnectCardController).toHaveBeenCalledOnce();
  });

  it("shows connection management for the connected settings card", () => {
    viewModel = {
      ...viewModel,
      configured: true,
      status: { kind: "connected", label: "Connected" },
      action: null,
      connectFlow: {
        configured: true,
        statusResolved: true,
        envManaged: false,
        agentNativeProvisioningEnabled: false,
        codeChangeConfigured: false,
        builderEnabled: true,
        orgName: "Acme",
        connecting: false,
        error: null,
        accountExists: false,
        hasFetchedStatus: true,
        credentialSource: "user",
        canDisconnect: true,
        grants: null,
        effective: null,
        canConnect: { org: false, personal: false },
        start: vi.fn(),
        retry: vi.fn(),
      },
    };
    mocks.useBuilderConnectCardController.mockReturnValue(viewModel);

    act(() =>
      root.render(
        <BuilderConnectCard showManage trackingSource="settings_connections" />,
      ),
    );

    expect(
      container.querySelector(
        'button[aria-label="Manage Builder.io connection"]',
      ),
    ).not.toBeNull();
  });

  it("keeps cancellation available after reconnect closes the management menu", () => {
    const flow = {
      configured: true,
      statusResolved: true,
      envManaged: false,
      agentNativeProvisioningEnabled: false,
      codeChangeConfigured: false,
      builderEnabled: true,
      orgName: "Acme",
      connecting: false,
      error: null,
      accountExists: false,
      hasFetchedStatus: true,
      credentialSource: "user" as const,
      canDisconnect: true,
      grants: null,
      effective: null,
      canConnect: { org: false, personal: false },
      start: vi.fn(),
      cancel: vi.fn(),
      retry: vi.fn(),
    };
    flow.start.mockImplementation(() => {
      flow.connecting = true;
    });
    viewModel = {
      ...viewModel,
      configured: true,
      status: { kind: "connected", label: "Connected" },
      action: null,
      connectFlow: flow,
    };
    mocks.useBuilderConnectCardController.mockReturnValue(viewModel);

    act(() => root.render(<BuilderConnectCard showManage />));
    act(() => {
      (
        container.querySelector(
          'button[aria-label="Manage Builder.io connection"]',
        ) as HTMLButtonElement
      ).click();
    });
    const reconnect = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Reconnect Builder.io"),
    );
    act(() => reconnect?.click());

    const cancel = container.querySelector<HTMLButtonElement>(
      "[data-testid='builder-connection-cancel']",
    );
    expect(cancel?.textContent).toBe("Cancel");
    act(() => cancel?.click());
    expect(flow.start).toHaveBeenCalledOnce();
    expect(flow.cancel).toHaveBeenCalledOnce();
  });

  it("hides disconnect for workspace-managed credentials", () => {
    viewModel = {
      ...viewModel,
      configured: true,
      status: { kind: "connected", label: "Connected" },
      action: null,
      connectFlow: {
        configured: true,
        statusResolved: true,
        envManaged: false,
        agentNativeProvisioningEnabled: false,
        codeChangeConfigured: false,
        builderEnabled: true,
        orgName: "Acme",
        connecting: false,
        error: null,
        accountExists: false,
        hasFetchedStatus: true,
        credentialSource: "workspace",
        canDisconnect: false,
        grants: null,
        effective: null,
        canConnect: { org: false, personal: false },
        start: vi.fn(),
        retry: vi.fn(),
      },
    };
    mocks.useBuilderConnectCardController.mockReturnValue(viewModel);

    act(() => {
      root.render(
        <BuilderConnectCard showManage trackingSource="settings_connections" />,
      );
    });
    act(() => {
      (
        container.querySelector(
          'button[aria-label="Manage Builder.io connection"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(document.body.textContent).toContain("Reconnect Builder.io");
    expect(document.body.textContent).not.toContain("Disconnect");
  });

  describe("organization and personal connections", () => {
    function scopedFlow(
      overrides: Partial<
        NonNullable<BuilderConnectCardViewModel["connectFlow"]>
      >,
    ) {
      return {
        configured: true,
        statusResolved: true,
        statusReadSettledCount: 1,
        envManaged: false,
        agentNativeProvisioningEnabled: false,
        codeChangeConfigured: false,
        builderEnabled: true,
        orgName: "Acme",
        connecting: false,
        error: null,
        accountExists: false,
        hasFetchedStatus: true,
        credentialSource: "org" as const,
        canDisconnect: false,
        grants: {
          org: { connectedAt: 1_000, needsReconnect: false },
        },
        effective: "org" as const,
        canConnect: { org: false, personal: true },
        start: vi.fn(),
        cancel: vi.fn(),
        retry: vi.fn(() => true),
        ...overrides,
      };
    }

    function renderManaged(
      flow: ReturnType<typeof scopedFlow>,
      scope?: "org" | "personal",
    ) {
      viewModel = {
        ...viewModel,
        configured: true,
        status: { kind: "connected", label: "Connected" },
        action: null,
        connectFlow: flow,
        ...(scope ? { scope } : {}),
      };
      mocks.useBuilderConnectCardController.mockReturnValue(viewModel);
      act(() => root.render(<BuilderConnectCard showManage />));
    }

    function openMenu() {
      act(() => {
        (
          container.querySelector(
            'button[aria-label="Manage Builder.io connection"]',
          ) as HTMLButtonElement
        ).click();
      });
    }

    function menuButton(label: string) {
      return Array.from(document.body.querySelectorAll("button")).find(
        (button) => button.textContent?.includes(label),
      );
    }

    it("gives a member riding the org connection no Reconnect that would shadow it", () => {
      renderManaged(scopedFlow({}));

      expect(
        container.querySelector(
          'button[aria-label="Manage Builder.io connection"]',
        ),
      ).toBeNull();
    });

    it("reconnects and disconnects the organization connection by name for an admin", async () => {
      const fetchMock = vi.fn(
        async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const flow = scopedFlow({
        canConnect: { org: true, personal: false },
        canDisconnect: true,
      });
      renderManaged(flow);

      openMenu();
      act(() => menuButton("Reconnect Builder.io")?.click());
      expect(flow.start).toHaveBeenCalledWith(
        expect.objectContaining({ scope: "org", provisionAccount: false }),
      );

      openMenu();
      act(() => menuButton("Disconnect")?.click());
      await act(async () => {
        menuButton("Confirm disconnect")?.click();
      });
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/_agent-native/builder/disconnect"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ scope: "org" }),
        }),
      );
    });

    it("targets the member's own grant from the Personal row", async () => {
      const fetchMock = vi.fn(
        async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const flow = scopedFlow({
        grants: {
          org: { connectedAt: 1_000, needsReconnect: false },
          personal: {
            connectedAt: 2_000,
            needsReconnect: false,
            restricted: false,
          },
        },
        effective: "personal",
        credentialSource: "user",
      });
      renderManaged(flow, "personal");

      openMenu();
      act(() => menuButton("Reconnect Builder.io")?.click());
      expect(flow.start).toHaveBeenCalledWith(
        expect.objectContaining({ scope: "personal" }),
      );

      openMenu();
      act(() => menuButton("Disconnect")?.click());
      await act(async () => {
        menuButton("Confirm disconnect")?.click();
      });
      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ scope: "personal" }),
        }),
      );
    });

    it("keeps Reconnect for an owner whose activated account is in effect personally", async () => {
      const fetchMock = vi.fn(
        async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const flow = scopedFlow({
        grants: {
          personal: {
            connectedAt: 2_000,
            needsReconnect: false,
            restricted: false,
            kind: "keys",
          },
        },
        effective: "personal",
        credentialSource: "user",
        canDisconnect: true,
        canConnect: { org: true, personal: false },
      });
      renderManaged(flow);

      openMenu();
      act(() => menuButton("Reconnect Builder.io")?.click());
      expect(flow.start).toHaveBeenCalledWith(
        expect.objectContaining({ scope: "org", provisionAccount: false }),
      );

      openMenu();
      act(() => menuButton("Disconnect")?.click());
      await act(async () => {
        menuButton("Confirm disconnect")?.click();
      });
      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ scope: "personal" }),
        }),
      );
    });

    it("keeps the role-decided Reconnect for a caller without an organization", () => {
      const flow = scopedFlow({
        grants: {
          personal: {
            connectedAt: 2_000,
            needsReconnect: false,
            restricted: false,
          },
        },
        effective: "personal",
        credentialSource: "user",
        canDisconnect: true,
        canConnect: { org: false, personal: false },
      });
      renderManaged(flow);

      openMenu();
      act(() => menuButton("Reconnect Builder.io")?.click());
      expect(flow.start).toHaveBeenCalledWith(
        expect.not.objectContaining({ scope: expect.anything() }),
      );
    });

    it("keeps the organization row read-only for a member", () => {
      renderManaged(scopedFlow({}), "org");

      expect(
        container.querySelector(
          'button[aria-label="Manage Builder.io connection"]',
        ),
      ).toBeNull();
    });
  });

  it("falls back to the default view when a product renderer fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    act(() =>
      root.render(
        <BuilderConnectCard
          render={() => {
            throw new Error("broken company card");
          }}
        />,
      ),
    );

    expect(container.textContent).toContain("Builder connect");
    expect(container.textContent).toContain("Ready to connect");
  });
});
