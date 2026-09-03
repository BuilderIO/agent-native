// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../components/ui/tooltip.js";
import { DEFAULT_MCP_INTEGRATIONS } from "./mcp-integration-catalog.js";
import { McpIntegrationDialog } from "./McpIntegrationDialog.js";

const mocks = vi.hoisted(() => ({
  navigateToMcpOAuthStart: vi.fn(),
  mcpServersQuery: {
    data: {
      user: [],
      org: [],
      orgId: "org-builder",
      role: "owner",
    },
    isSuccess: true,
    isError: false,
    error: null as Error | null,
    isFetching: false,
    refetch: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("./mcp-integration-catalog.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./mcp-integration-catalog.js")>()),
  navigateToMcpOAuthStart: mocks.navigateToMcpOAuthStart,
}));

vi.mock("./use-mcp-servers.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-mcp-servers.js")>()),
  useMcpServers: () => mocks.mcpServersQuery,
}));

describe("McpIntegrationDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.navigateToMcpOAuthStart.mockReset();
    mocks.mcpServersQuery.isSuccess = true;
    mocks.mcpServersQuery.isError = false;
    mocks.mcpServersQuery.error = null;
    mocks.mcpServersQuery.isFetching = false;
    mocks.mcpServersQuery.refetch.mockReset().mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.querySelectorAll("[data-radix-portal]").forEach((node) => {
      node.remove();
    });
    vi.unstubAllGlobals();
  });

  it("keeps unsupported OAuth integrations personal without a scope prompt", () => {
    const linear = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "linear",
    )!;

    act(() => {
      root.render(
        <TooltipProvider>
          <McpIntegrationDialog
            open
            onOpenChange={() => {}}
            initialIntegrationId="linear"
            defaultScope="org"
            canCreateOrgMcp
            hasOrg
            onCreateMcpServer={vi.fn()}
            integrations={[linear]}
          />
        </TooltipProvider>,
      );
    });

    expect(document.body.textContent).not.toContain("Shared with workspace");

    const connectButtons = [...document.body.querySelectorAll("button")].filter(
      (button) => button.textContent === "Connect",
    );
    expect(connectButtons).toHaveLength(1);

    act(() => connectButtons[0]?.click());

    expect(mocks.navigateToMcpOAuthStart).toHaveBeenCalledOnce();
    const url = mocks.navigateToMcpOAuthStart.mock.calls[0]?.[0];
    expect(
      new URL(url, "https://analytics.example.com").searchParams.get("scope"),
    ).toBe("user");
  });

  it("waits for the desktop OAuth target before connecting", () => {
    const linear = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "linear",
    )!;

    act(() => {
      root.render(
        <TooltipProvider>
          <McpIntegrationDialog
            open
            onOpenChange={() => {}}
            initialIntegrationId="linear"
            defaultScope="user"
            canCreateOrgMcp
            hasOrg
            onCreateMcpServer={vi.fn()}
            integrations={[linear]}
            oauthReady={false}
          />
        </TooltipProvider>,
      );
    });

    const connect = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Connect",
    );
    expect(connect).toHaveProperty("disabled", true);
    act(() => connect?.click());
    expect(mocks.navigateToMcpOAuthStart).not.toHaveBeenCalled();
  });

  it("offers a shared scope for an integration that supports it", () => {
    const context7 = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "context7",
    )!;
    const onCreateMcpServer = vi.fn().mockResolvedValue(undefined);

    act(() => {
      root.render(
        <TooltipProvider>
          <McpIntegrationDialog
            open
            onOpenChange={() => {}}
            connectIntegrationId="context7"
            defaultScope="user"
            canCreateOrgMcp
            hasOrg
            onCreateMcpServer={onCreateMcpServer}
            integrations={[context7]}
          />
        </TooltipProvider>,
      );
    });

    expect(document.body.textContent).toContain("Who should use this?");

    const shared = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Set up for workspace",
    );
    expect(shared).toBeTruthy();
    act(() => shared?.click());

    expect(onCreateMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "org" }),
    );
  });

  it("asks for scope before quick connecting in an organization", () => {
    const context7 = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "context7",
    )!;
    const onCreateMcpServer = vi.fn().mockResolvedValue(undefined);

    act(() => {
      root.render(
        <TooltipProvider>
          <McpIntegrationDialog
            open
            onOpenChange={() => {}}
            quickConnectIntegrationId="context7"
            defaultScope="org"
            canCreateOrgMcp
            hasOrg
            onCreateMcpServer={onCreateMcpServer}
            integrations={[context7]}
          />
        </TooltipProvider>,
      );
    });

    expect(document.body.textContent).toContain("Who should use this?");
    expect(onCreateMcpServer).not.toHaveBeenCalled();

    const personal = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Connect for me",
    );
    expect(personal).toBeTruthy();
    act(() => personal?.click());

    expect(onCreateMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "user" }),
    );
  });

  it("waits for scope metadata before auto-connecting", () => {
    const context7 = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "context7",
    )!;
    const onCreateMcpServer = vi.fn().mockResolvedValue(undefined);
    mocks.mcpServersQuery.isSuccess = false;

    act(() => {
      root.render(
        <TooltipProvider>
          <McpIntegrationDialog
            open
            onOpenChange={() => {}}
            connectIntegrationId="context7"
            defaultScope="user"
            canCreateOrgMcp={false}
            hasOrg={false}
            onCreateMcpServer={onCreateMcpServer}
            integrations={[context7]}
          />
        </TooltipProvider>,
      );
    });

    expect(document.body.textContent).not.toContain("Who should use this?");
    expect(onCreateMcpServer).not.toHaveBeenCalled();

    mocks.mcpServersQuery.isSuccess = true;
    act(() => {
      root.render(
        <TooltipProvider>
          <McpIntegrationDialog
            open
            onOpenChange={() => {}}
            connectIntegrationId="context7"
            defaultScope="user"
            canCreateOrgMcp
            hasOrg
            onCreateMcpServer={onCreateMcpServer}
            integrations={[context7]}
          />
        </TooltipProvider>,
      );
    });

    expect(document.body.textContent).toContain("Who should use this?");
    expect(onCreateMcpServer).not.toHaveBeenCalled();
  });

  it("waits for scope metadata before quick connecting", () => {
    const context7 = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "context7",
    )!;
    const onCreateMcpServer = vi.fn().mockResolvedValue(undefined);
    mocks.mcpServersQuery.isSuccess = false;

    act(() => {
      root.render(
        <TooltipProvider>
          <McpIntegrationDialog
            open
            onOpenChange={() => {}}
            quickConnectIntegrationId="context7"
            defaultScope="user"
            canCreateOrgMcp={false}
            hasOrg={false}
            onCreateMcpServer={onCreateMcpServer}
            integrations={[context7]}
          />
        </TooltipProvider>,
      );
    });

    expect(mocks.navigateToMcpOAuthStart).not.toHaveBeenCalled();
    expect(onCreateMcpServer).not.toHaveBeenCalled();

    mocks.mcpServersQuery.isSuccess = true;
    act(() => {
      root.render(
        <TooltipProvider>
          <McpIntegrationDialog
            open
            onOpenChange={() => {}}
            quickConnectIntegrationId="context7"
            defaultScope="user"
            canCreateOrgMcp
            hasOrg
            onCreateMcpServer={onCreateMcpServer}
            integrations={[context7]}
          />
        </TooltipProvider>,
      );
    });

    expect(document.body.textContent).toContain("Who should use this?");
    expect(mocks.navigateToMcpOAuthStart).not.toHaveBeenCalled();
    expect(onCreateMcpServer).not.toHaveBeenCalled();
  });

  it("disables catalog connections while scope metadata is loading", () => {
    const context7 = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "context7",
    )!;
    mocks.mcpServersQuery.isSuccess = false;

    act(() => {
      root.render(
        <TooltipProvider>
          <McpIntegrationDialog
            open
            onOpenChange={() => {}}
            defaultScope="user"
            canCreateOrgMcp={false}
            hasOrg={false}
            onCreateMcpServer={vi.fn()}
            integrations={[context7]}
          />
        </TooltipProvider>,
      );
    });

    expect(document.body.textContent).toContain("Loading connection scope…");
    expect(
      document.body.querySelector('button[aria-label="Connect Context7"]'),
    ).toHaveProperty("disabled", true);
    expect(mocks.navigateToMcpOAuthStart).not.toHaveBeenCalled();
  });

  it("waits for scope metadata before opening an initial setup", () => {
    const gong = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "gong",
    )!;
    mocks.mcpServersQuery.isSuccess = false;

    act(() => {
      root.render(
        <TooltipProvider>
          <McpIntegrationDialog
            open
            onOpenChange={() => {}}
            initialIntegrationId="gong"
            defaultScope="user"
            canCreateOrgMcp={false}
            hasOrg={false}
            onCreateMcpServer={vi.fn()}
            integrations={[gong]}
          />
        </TooltipProvider>,
      );
    });

    expect(document.body.textContent).toContain("Loading connection scope…");
    expect(document.body.textContent).not.toContain("Provider setup required");

    mocks.mcpServersQuery.isSuccess = true;
    act(() => {
      root.render(
        <TooltipProvider>
          <McpIntegrationDialog
            open
            onOpenChange={() => {}}
            initialIntegrationId="gong"
            defaultScope="user"
            canCreateOrgMcp
            hasOrg
            onCreateMcpServer={vi.fn()}
            integrations={[gong]}
          />
        </TooltipProvider>,
      );
    });

    expect(document.body.textContent).toContain("Who should use this?");
  });

  it("surfaces a retry when scope metadata fails before direct connecting", () => {
    const context7 = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "context7",
    )!;
    mocks.mcpServersQuery.isSuccess = false;
    mocks.mcpServersQuery.isError = true;
    mocks.mcpServersQuery.error = new Error("Scope metadata unavailable");

    act(() => {
      root.render(
        <TooltipProvider>
          <McpIntegrationDialog
            open
            onOpenChange={() => {}}
            connectIntegrationId="context7"
            defaultScope="user"
            canCreateOrgMcp={false}
            hasOrg={false}
            onCreateMcpServer={vi.fn()}
            integrations={[context7]}
          />
        </TooltipProvider>,
      );
    });

    expect(
      document.body.querySelector('[role="alert"]')?.textContent,
    ).toContain("Scope metadata unavailable");
    const retry = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    );
    expect(retry).toBeTruthy();

    act(() => retry?.click());

    expect(mocks.mcpServersQuery.refetch).toHaveBeenCalledOnce();
    expect(mocks.navigateToMcpOAuthStart).not.toHaveBeenCalled();
  });

  it("surfaces a retry when scope metadata fails before quick connecting", () => {
    const context7 = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "context7",
    )!;
    mocks.mcpServersQuery.isSuccess = false;
    mocks.mcpServersQuery.isError = true;
    mocks.mcpServersQuery.error = new Error("Scope metadata unavailable");

    act(() => {
      root.render(
        <TooltipProvider>
          <McpIntegrationDialog
            open
            onOpenChange={() => {}}
            quickConnectIntegrationId="context7"
            defaultScope="user"
            canCreateOrgMcp={false}
            hasOrg={true}
            onCreateMcpServer={vi.fn()}
            integrations={[context7]}
          />
        </TooltipProvider>,
      );
    });

    expect(
      document.body.querySelector('[role="alert"]')?.textContent,
    ).toContain("Scope metadata unavailable");
    const retry = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    );
    expect(retry).toBeTruthy();

    act(() => retry?.click());

    expect(mocks.mcpServersQuery.refetch).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain("Who should use this?");
  });

  it("routes catalog connections through the scope choice in an organization", () => {
    const context7 = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "context7",
    )!;
    const onCreateMcpServer = vi.fn().mockResolvedValue(undefined);

    act(() => {
      root.render(
        <TooltipProvider>
          <McpIntegrationDialog
            open
            onOpenChange={() => {}}
            defaultScope="user"
            canCreateOrgMcp
            hasOrg
            onCreateMcpServer={onCreateMcpServer}
            integrations={[context7]}
          />
        </TooltipProvider>,
      );
    });

    act(() => {
      document.body
        .querySelector('button[aria-label="Connect Context7"]')
        ?.click();
    });

    expect(document.body.textContent).toContain("Who should use this?");
    expect(onCreateMcpServer).not.toHaveBeenCalled();
  });

  it("routes an initial workspace-capable setup through the scope choice", () => {
    const gong = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "gong",
    )!;

    act(() => {
      root.render(
        <TooltipProvider>
          <McpIntegrationDialog
            open
            onOpenChange={() => {}}
            initialIntegrationId="gong"
            defaultScope="user"
            canCreateOrgMcp
            hasOrg
            onCreateMcpServer={vi.fn()}
            integrations={[gong]}
          />
        </TooltipProvider>,
      );
    });

    expect(document.body.textContent).toContain("Who should use this?");
    expect(document.body.textContent).not.toContain("Provider setup required");

    const workspace = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Set up for workspace",
    );
    expect(workspace).toBeTruthy();
    act(() => workspace?.click());

    expect(document.body.textContent).toContain("Provider setup required");
    const continueButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Connect my account",
    );
    expect(continueButton).toBeTruthy();

    act(() => continueButton?.click());

    const url = mocks.navigateToMcpOAuthStart.mock.calls[0]?.[0];
    expect(
      new URL(url, "https://analytics.example.com").searchParams.get("scope"),
    ).toBe("org");
  });

  it("shows a disabled workspace option to a member", () => {
    const context7 = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "context7",
    )!;
    const onCreateMcpServer = vi.fn().mockResolvedValue(undefined);

    act(() => {
      root.render(
        <TooltipProvider>
          <McpIntegrationDialog
            open
            onOpenChange={() => {}}
            connectIntegrationId="context7"
            defaultScope="org"
            canCreateOrgMcp={false}
            hasOrg
            onCreateMcpServer={onCreateMcpServer}
            integrations={[context7]}
          />
        </TooltipProvider>,
      );
    });

    expect(document.body.textContent).toContain("Who should use this?");
    expect(document.body.textContent).toContain(
      "Workspace owner or admin required.",
    );
    const workspace = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Set up for workspace") ?? false,
    );
    expect(workspace).toBeTruthy();
    expect(workspace).toHaveProperty("disabled", true);

    const personal = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Connect for me",
    );
    act(() => personal?.click());
    expect(onCreateMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "user" }),
    );
  });

  it("explains personal-only integrations before connecting in an organization", () => {
    const linear = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "linear",
    )!;

    act(() => {
      root.render(
        <TooltipProvider>
          <McpIntegrationDialog
            open
            onOpenChange={() => {}}
            connectIntegrationId="linear"
            defaultScope="org"
            canCreateOrgMcp
            hasOrg
            onCreateMcpServer={vi.fn()}
            integrations={[linear]}
          />
        </TooltipProvider>,
      );
    });

    expect(document.body.textContent).not.toContain("Who should use this?");
    expect(document.body.textContent).not.toContain("Set up for workspace");

    const connect = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Connect",
    );
    act(() => connect?.click());
    expect(mocks.navigateToMcpOAuthStart).toHaveBeenCalledOnce();
  });

  it("routes personal-only provider setup directly to a personal connection", () => {
    const atlassian = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "atlassian",
    )!;

    act(() => {
      root.render(
        <TooltipProvider>
          <McpIntegrationDialog
            open
            onOpenChange={() => {}}
            quickConnectIntegrationId="atlassian"
            defaultScope="org"
            canCreateOrgMcp
            hasOrg
            onCreateMcpServer={vi.fn()}
            integrations={[atlassian]}
          />
        </TooltipProvider>,
      );
    });

    expect(document.body.textContent).not.toContain("Who should use this?");
    expect(document.body.textContent).toContain("Connect Jira");
    expect(document.body.textContent).toContain("Personal connection");
    expect(document.body.textContent).toContain(
      "Only you can use this connection.",
    );
    expect(document.body.textContent).toContain("Open setup guide");
    expect(document.body.querySelectorAll('a[target="_blank"]')).toHaveLength(
      1,
    );

    const connect = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Connect my account",
    );
    expect(connect).toBeTruthy();
    act(() => connect?.click());

    const url = mocks.navigateToMcpOAuthStart.mock.calls[0]?.[0];
    expect(
      new URL(url, "https://analytics.example.com").searchParams.get("scope"),
    ).toBe("user");
  });

  it("does not offer an unauthenticated test for setup-gated integrations", () => {
    const slack = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "slack",
    )!;

    act(() => {
      root.render(
        <TooltipProvider>
          <McpIntegrationDialog
            open
            onOpenChange={() => {}}
            initialIntegrationId="slack"
            defaultScope="user"
            canCreateOrgMcp={false}
            hasOrg
            onCreateMcpServer={vi.fn()}
            integrations={[slack]}
          />
        </TooltipProvider>,
      );
    });

    expect(
      [...document.body.querySelectorAll("button")].find(
        (button) => button.textContent === "Test",
      ),
    ).toBeUndefined();
    expect(document.body.textContent).toContain("Connect Slack");
    expect(document.body.textContent).toContain("Provider setup required");
    expect(document.body.textContent).toContain("Open setup guide");
    expect(
      [...document.body.querySelectorAll("a")]
        .find((link) => link.textContent?.includes("Open setup guide"))
        ?.getAttribute("href"),
    ).toBe(slack.docsUrl);

    const continueButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Connect my account",
    );
    expect(continueButton).toBeTruthy();

    act(() => continueButton?.click());
    expect(mocks.navigateToMcpOAuthStart).toHaveBeenCalledOnce();
  });

  it("opens provider setup guidance from the catalog", () => {
    const slack = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "slack",
    )!;

    act(() => {
      root.render(
        <TooltipProvider>
          <McpIntegrationDialog
            open
            onOpenChange={() => {}}
            defaultScope="user"
            canCreateOrgMcp={false}
            hasOrg
            onCreateMcpServer={vi.fn()}
            integrations={[slack]}
          />
        </TooltipProvider>,
      );
    });

    const viewSetupButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Open setup guide",
    );
    expect(viewSetupButton).toBeTruthy();

    act(() => viewSetupButton?.click());
    expect(document.body.textContent).not.toContain("Who should use this?");
    expect(document.body.textContent).toContain("Provider setup required");
  });

  it("offers personal OAuth for a managed setup-gated integration", () => {
    const hubspot = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "hubspot",
    )!;

    act(() => {
      root.render(
        <TooltipProvider>
          <McpIntegrationDialog
            open
            onOpenChange={() => {}}
            initialIntegrationId="hubspot"
            defaultScope="org"
            canCreateOrgMcp
            hasOrg
            onCreateMcpServer={vi.fn()}
            integrations={[hubspot]}
          />
        </TooltipProvider>,
      );
    });

    expect(document.body.textContent).not.toContain("Shared with workspace");

    const connectButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Connect",
    );
    expect(connectButton).toBeTruthy();

    act(() => connectButton?.click());

    expect(mocks.navigateToMcpOAuthStart).toHaveBeenCalledOnce();
    const url = mocks.navigateToMcpOAuthStart.mock.calls[0]?.[0];
    expect(
      new URL(url, "https://analytics.example.com").searchParams.get("scope"),
    ).toBe("user");
  });
});
