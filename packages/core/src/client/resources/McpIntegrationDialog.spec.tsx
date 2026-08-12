// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../components/ui/tooltip.js";
import { DEFAULT_MCP_INTEGRATIONS } from "./mcp-integration-catalog.js";
import { McpIntegrationDialog } from "./McpIntegrationDialog.js";

const mocks = vi.hoisted(() => ({
  navigateToMcpOAuthStart: vi.fn(),
}));

vi.mock("./mcp-integration-catalog.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./mcp-integration-catalog.js")>()),
  navigateToMcpOAuthStart: mocks.navigateToMcpOAuthStart,
}));

vi.mock("./use-mcp-servers.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-mcp-servers.js")>()),
  useMcpServers: () => ({
    data: {
      user: [],
      org: [],
      orgId: "org-builder",
      role: "owner",
    },
    isSuccess: true,
  }),
}));

describe("McpIntegrationDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.navigateToMcpOAuthStart.mockReset();
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
            initialIntegrationId="context7"
            defaultScope="user"
            canCreateOrgMcp
            hasOrg
            onCreateMcpServer={onCreateMcpServer}
            integrations={[context7]}
          />
        </TooltipProvider>,
      );
    });

    expect(document.body.textContent).toContain(
      "Who should be able to use this connection?",
    );
    expect(document.body.textContent).toContain(
      "Only you can use this connection.",
    );

    const shared = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Shared with workspace",
    );
    expect(shared).toBeTruthy();
    act(() => shared?.click());
    expect(document.body.textContent).toContain(
      "Permitted workspace members can use this connection. Provider permissions still apply.",
    );

    const connectButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Connect",
    );
    expect(connectButton).toBeTruthy();
    act(() => connectButton?.click());

    expect(onCreateMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "org" }),
    );
  });

  it("quick-connects catalog integrations personally by default", () => {
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

    expect(document.body.textContent).not.toContain(
      "Who should be able to use this connection?",
    );
    expect(onCreateMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "user" }),
    );
  });

  it("does not show organization scope to a member", () => {
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
            canCreateOrgMcp={false}
            hasOrg
            onCreateMcpServer={vi.fn()}
            integrations={[linear]}
          />
        </TooltipProvider>,
      );
    });

    expect(document.body.textContent).not.toContain("Organization");
    expect(document.body.textContent).not.toContain("owners and admins");
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
    expect(document.body.textContent).toContain("Set up Slack");
    expect(document.body.textContent).toContain("Provider setup required");
    expect(document.body.textContent).toContain("View setup");
    expect(
      [...document.body.querySelectorAll("a")]
        .find((link) => link.textContent?.includes("View setup"))
        ?.getAttribute("href"),
    ).toBe(slack.docsUrl);

    const continueButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "I've completed setup",
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
      (button) => button.textContent === "View setup",
    );
    expect(viewSetupButton).toBeTruthy();

    act(() => viewSetupButton?.click());
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
