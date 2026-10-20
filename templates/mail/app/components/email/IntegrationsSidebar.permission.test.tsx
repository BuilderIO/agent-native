// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  copy: {
    "mail.integrations.addIntegration": "Add integration",
    "mail.integrations.gongDescription": "Gong call history",
    "mail.integrations.gongAccessCheckFailed":
      "Couldn't check whether you can connect to Gong.",
    "mail.integrations.connect": "Connect",
    "mail.integrations.gongKeyFormatHint":
      "Enter the access key and secret as access_key:secret.",
    "mail.integrations.updateKey": "Update key",
    "mail.integrations.disconnect": "Disconnect",
    "mail.toolbar.settings": "Settings",
    "mail.error.tryAgain": "Try again",
    "mail.error.retrying": "Retrying...",
  } as Record<string, string>,
  mcpServersQuery: {
    data: undefined as unknown,
    isSuccess: false,
    isError: true,
    isFetching: false,
    refetch: vi.fn(),
  },
  statuses: {
    apollo: false,
    hubspot: false,
    gong: false,
    pylon: false,
  },
  navigate: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => mocks.copy[key] ?? key,
}));

vi.mock("@agent-native/core/navigation", () => ({
  buildSettingsRoute: (section: string) => `/settings/${section}`,
}));

vi.mock("react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@agent-native/core/client/resources", () => ({
  useMcpServers: () => mocks.mcpServersQuery,
  useCreateMcpServer: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@agent-native/toolkit/app/chat/composer", () => ({
  useSendToAgentChat: () => ({ send: vi.fn(), codeRequiredDialog: null }),
}));

vi.mock("@agent-native/toolkit/app/extensions", () => ({
  ExtensionSlot: () => null,
}));

vi.mock("@agent-native/toolkit/app/resources", () => ({
  McpIntegrationDialog: () => null,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: () => null,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div role="menu">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button role="menuitem" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("@/hooks/use-integrations", () => ({
  useAllIntegrations: () => mocks.statuses,
  useIntegration: () => ({
    connect: { error: null, isPending: false, mutate: vi.fn(), reset: vi.fn() },
    disconnect: { mutate: vi.fn() },
  }),
  useHubSpotContact: vi.fn(),
  useGongCalls: () => ({ data: [], isLoading: false, error: null }),
  usePylonContact: vi.fn(),
  isAuthError: () => false,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { IntegrationsSidebar } from "./IntegrationsSidebar";

function renderSidebar() {
  return render(
    <IntegrationsSidebar
      email="person@example.test"
      displayName="Person"
      recentEmails={[]}
    />,
  );
}

afterEach(() => {
  cleanup();
  mocks.statuses.gong = false;
  vi.clearAllMocks();
});

describe("Gong permission lookup in the integrations sidebar", () => {
  it("keeps Gong hidden when a permission lookup fails without known access", () => {
    const refetch = vi.fn();
    mocks.mcpServersQuery = {
      data: undefined,
      isSuccess: false,
      isError: true,
      isFetching: false,
      refetch,
    };

    renderSidebar();

    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add integrations" }));
    expect(screen.queryByText("Gong call history")).toBeNull();
    expect(refetch).not.toHaveBeenCalled();
  });

  it("shows a retryable error when a known manager's lookup fails", () => {
    const refetch = vi.fn();
    mocks.mcpServersQuery = {
      data: { user: [], org: [], orgId: "org-1", role: "admin" },
      isSuccess: false,
      isError: true,
      isFetching: false,
      refetch,
    };

    renderSidebar();

    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't check whether you can connect to Gong.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("silently hides Gong for a confirmed workspace member", () => {
    mocks.mcpServersQuery = {
      data: { user: [], org: [], orgId: "org-1", role: "member" },
      isSuccess: true,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    };

    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Add integrations" }));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Gong call history")).toBeNull();
  });

  it("shows an existing org Gong connection to members without setup controls", () => {
    mocks.mcpServersQuery = {
      data: {
        user: [],
        org: [
          {
            id: "gong-server",
            scope: "org",
            name: "Gong",
            url: "https://mcp.gong.io/mcp",
            authMode: "oauth",
            createdAt: 0,
            mergedId: "gong-server",
            status: { state: "connected", toolCount: 3 },
          },
        ],
        orgId: "org-1",
        role: "member",
      },
      isSuccess: true,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    };

    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /Integrations/ }));

    expect(screen.getByText("Gong call history")).not.toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Connect" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Settings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
  });

  it("preserves connected state and manager controls when a background refetch fails", () => {
    mocks.mcpServersQuery = {
      data: {
        user: [],
        org: [
          {
            id: "gong-server",
            scope: "org",
            name: "Gong",
            url: "https://mcp.gong.io/mcp",
            authMode: "oauth",
            createdAt: 0,
            mergedId: "gong-server",
            status: { state: "connected", toolCount: 3 },
          },
        ],
        orgId: "org-1",
        role: "admin",
      },
      isSuccess: false,
      isError: true,
      isFetching: false,
      refetch: vi.fn(),
    };

    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Integrations (1/4)" }));

    expect(screen.getByText("Gong call history")).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't check whether you can connect to Gong.",
    );
    expect(screen.getByRole("menuitem", { name: "Settings" })).not.toBeNull();
  });

  it("keeps legacy key controls for a member without org setup permission", () => {
    mocks.mcpServersQuery = {
      data: { user: [], org: [], orgId: "org-1", role: "member" },
      isSuccess: true,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    };
    mocks.statuses.gong = true;

    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /Integrations/ }));

    expect(screen.getByText("Gong call history")).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: "Update key" })).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: "Disconnect" })).not.toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Connect" })).toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: "Update key" }));
    expect(
      screen.getByText("Enter the access key and secret as access_key:secret."),
    ).not.toBeNull();
  });

  it("opens shared MCP settings for a connected Gong server", () => {
    mocks.mcpServersQuery = {
      data: {
        user: [
          {
            id: "gong-server",
            scope: "user",
            name: "Gong",
            url: "https://mcp.gong.io/mcp",
            authMode: "oauth",
            createdAt: 0,
            mergedId: "gong-server",
            status: { state: "connected", toolCount: 3 },
          },
        ],
        org: [],
        orgId: null,
        role: null,
      },
      isSuccess: true,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    };

    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /Integrations/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Settings" }));

    expect(mocks.navigate).toHaveBeenCalledWith("/settings/integrations");
  });
});
