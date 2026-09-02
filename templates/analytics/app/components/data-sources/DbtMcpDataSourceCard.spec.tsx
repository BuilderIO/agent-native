// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reconnect: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/resources", () => ({
  formatMcpServersLoadError: (error: unknown) => String(error),
  getDefaultMcpIntegrations: () => [
    {
      id: "dbt",
      name: "dbt",
      logoUrl: "",
      availability: "provider-setup",
      connectionMode: "manual",
      supportsOrganizationScope: true,
    },
  ],
  McpIntegrationDialog: ({
    open,
    defaultScope,
    integrations,
  }: {
    open: boolean;
    defaultScope: string;
    integrations: Array<{
      availability?: string;
      connectionMode?: string;
      supportsOrganizationScope?: boolean;
    }>;
  }) =>
    open ? (
      <div
        data-testid="mcp-create-dialog"
        data-scope={defaultScope}
        data-availability={integrations[0]?.availability ?? "direct-form"}
        data-connection-mode={integrations[0]?.connectionMode}
        data-supports-org-scope={String(
          integrations[0]?.supportsOrganizationScope,
        )}
      />
    ) : null,
  McpIntegrationLogo: () => null,
  useCreateMcpServer: () => ({ mutateAsync: vi.fn() }),
  useMcpServers: () => ({
    data: {
      user: [],
      org: [
        {
          id: "stored-dbt",
          mergedId: "org_workspace_stored-dbt",
          scope: "org",
        },
      ],
    },
    error: null,
  }),
  useReconnectMcpServer: () => ({
    mutate: mocks.reconnect,
    isPending: false,
    error: null,
  }),
}));

import { DbtMcpDataSourceCard } from "./DbtMcpDataSourceCard";

describe("DbtMcpDataSourceCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.reconnect.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("reconnects the existing organization server instead of opening create", async () => {
    await act(async () => {
      root.render(
        <DbtMcpDataSourceCard
          status={{
            available: true,
            configured: true,
            serverId: "org_workspace_stored-dbt",
            capabilities: {
              discovery: true,
              lineage: true,
              healthAndFreshness: true,
              semanticLayer: true,
            },
            sqlTools: { available: false, intentionallyUnused: true },
            toolCount: 8,
            setupLink: "/data-sources?source=dbt&returnTo=ask",
          }}
          isLoading={false}
          canManageOrg
          hasOrg
          focused={false}
          showAskContinuation={false}
          onSaved={vi.fn()}
        />,
      );
    });

    const reconnectButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent === "dataSources.reconnect");
    expect(reconnectButton).toBeTruthy();

    await act(async () => reconnectButton?.click());

    expect(mocks.reconnect).toHaveBeenCalledWith(
      { id: "stored-dbt", scope: "org" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(
      container.querySelector('[data-testid="mcp-create-dialog"]'),
    ).toBeNull();
  });

  it("opens the dbt manual form with organization scope enforced", async () => {
    await act(async () => {
      root.render(
        <DbtMcpDataSourceCard
          status={{
            available: true,
            configured: false,
            capabilities: {
              discovery: false,
              lineage: false,
              healthAndFreshness: false,
              semanticLayer: false,
            },
            sqlTools: { available: false, intentionallyUnused: true },
            toolCount: 0,
            setupLink: "/data-sources?source=dbt&returnTo=ask",
          }}
          isLoading={false}
          canManageOrg
          hasOrg
          focused
          showAskContinuation
          onSaved={vi.fn()}
        />,
      );
    });

    const connectButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "dataSources.connect",
    );
    expect(connectButton).toBeTruthy();

    await act(async () => connectButton?.click());

    const dialog = container.querySelector('[data-testid="mcp-create-dialog"]');
    expect(dialog?.getAttribute("data-scope")).toBe("org");
    expect(dialog?.getAttribute("data-availability")).toBe("ready");
    expect(dialog?.getAttribute("data-connection-mode")).toBe("direct");
    expect(dialog?.getAttribute("data-supports-org-scope")).toBe("false");
  });

  it("shows connected state without mutation controls to non-admin members", async () => {
    await act(async () => {
      root.render(
        <DbtMcpDataSourceCard
          status={{
            available: true,
            configured: true,
            serverId: "org_workspace_stored-dbt",
            capabilities: {
              discovery: true,
              lineage: true,
              healthAndFreshness: true,
              semanticLayer: true,
            },
            sqlTools: { available: false, intentionallyUnused: true },
            toolCount: 8,
            setupLink: "/data-sources?source=dbt&returnTo=ask",
          }}
          isLoading={false}
          canManageOrg={false}
          hasOrg
          focused={false}
          showAskContinuation={false}
          onSaved={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("dataSources.dbtConnectedTools");
    expect(container.querySelector("button")).toBeNull();
    expect(mocks.reconnect).not.toHaveBeenCalled();
  });
});
