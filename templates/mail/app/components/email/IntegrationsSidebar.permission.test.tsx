// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  copy: {
    "mail.integrations.addIntegration": "Add integration",
    "mail.integrations.gongDescription": "Gong calls and deals",
    "mail.integrations.gongAccessCheckFailed":
      "Couldn't check whether you can connect to Gong.",
    "mail.integrations.connect": "Connect",
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
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => mocks.copy[key] ?? key,
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
  it("shows a retryable error and keeps Gong hidden when lookup fails", () => {
    const refetch = vi.fn();
    mocks.mcpServersQuery = {
      data: undefined,
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

    fireEvent.click(screen.getByRole("button", { name: "Add integrations" }));
    expect(screen.queryByText("Gong calls and deals")).toBeNull();
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
    expect(screen.queryByText("Gong calls and deals")).toBeNull();
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

    expect(screen.getByText("Gong calls and deals")).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: "Update key" })).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: "Disconnect" })).not.toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Connect" })).toBeNull();
  });
});
