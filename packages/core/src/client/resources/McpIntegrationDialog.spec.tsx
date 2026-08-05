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

  it("uses the selected personal scope and shows one OAuth connect action", () => {
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

    const personal = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Personal",
    );
    expect(personal).toBeTruthy();
    act(() => personal?.click());

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
    expect(document.body.textContent).toContain("View setup");
  });
});
