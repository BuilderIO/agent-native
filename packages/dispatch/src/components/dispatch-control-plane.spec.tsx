// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DispatchControlPlane } from "./dispatch-control-plane";
import { TooltipProvider } from "./ui/tooltip";

const clientState = vi.hoisted(() => ({
  inBuilderFrame: false,
  navigateWithTransition: vi.fn(),
  promptComposerProps: null as Record<string, unknown> | null,
  workspaceApps: [] as Array<Record<string, unknown>>,
  connectedApps: [] as Array<Record<string, unknown>>,
  curatedTemplates: [] as Array<Record<string, unknown>>,
  useChatModels: vi.fn(() => ({
    availableModels: [],
    defaultModel: "auto",
    selectedModel: "auto",
    selectedEngine: "",
    selectedEffort: "medium" as const,
    isLoading: false,
    onModelChange: vi.fn(),
    onEffortChange: vi.fn(),
    refreshEngines: vi.fn(),
  })),
  activeOrgId: "org-a" as string | null,
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  chatModelSelectionStorageKey: (namespace: string) =>
    `agent-native:chat-models:selection:${namespace}`,
  navigateWithAgentChatViewTransition: (
    navigate: unknown,
    path: string,
    options?: unknown,
  ) => clientState.navigateWithTransition(navigate, path, options),
  orderChatFirstAppIds: (appIds: string[]) => appIds,
  readChatFirstAppLayout: () => ({ pinnedIds: [], orderedIds: [] }),
  writeChatFirstAppLayout: () => ({ ok: true }),
  useChatModels: clientState.useChatModels,
}));

vi.mock("@agent-native/core/client/composer", () => ({
  PromptComposer: (props: Record<string, unknown>) => {
    clientState.promptComposerProps = props;
    const onSubmit = props.onSubmit as (value: string) => void;
    const placeholder = props.placeholder as string;
    return (
      <button
        type="button"
        data-placeholder={placeholder}
        onClick={() => onSubmit("Route onboarding work")}
      >
        Composer
      </button>
    );
  },
}));

vi.mock("@agent-native/core/client/application-state", () => ({
  readClientAppState: vi.fn(async () => null),
  writeClientAppState: vi.fn(async () => null),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (name: string) => ({
    data:
      name === "list-connected-agents"
        ? clientState.connectedApps
        : name === "list-curated-workspace-templates"
          ? clientState.curatedTemplates
          : clientState.workspaceApps,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useActionMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrgRole: () => ({
    org: clientState.activeOrgId
      ? { orgId: clientState.activeOrgId }
      : undefined,
  }),
}));

vi.mock("@agent-native/core/client/host", () => ({
  getClientSurface: () => "web",
  isInBuilderFrame: () => clientState.inBuilderFrame,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: { defaultValue?: string }) =>
    values?.defaultValue ?? key,
  useFormatters: () => ({ formatDate: (value: string) => value }),
}));

vi.mock("./create-app-popover", () => ({
  CreateAppPopover: ({ trigger }: { trigger?: React.ReactNode }) => (
    <div>
      {trigger}
      <span>Create app</span>
    </div>
  ),
}));

describe("DispatchControlPlane", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  async function searchApps(query: string) {
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Search apps"]',
    );
    expect(input).not.toBeNull();
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      valueSetter?.call(input, query);
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    clientState.inBuilderFrame = false;
    clientState.navigateWithTransition.mockReset();
    clientState.promptComposerProps = null;
    clientState.workspaceApps = [];
    clientState.connectedApps = [];
    clientState.curatedTemplates = [];
    clientState.activeOrgId = "org-a";
    clientState.useChatModels.mockClear();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders a minimal Ask surface and transitions submitted prompts into Chat", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/overview"]}>
          <TooltipProvider>
            <QueryClientProvider client={queryClient}>
              <DispatchControlPlane />
            </QueryClientProvider>
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Chat across your apps");
    expect(container.querySelector('[class*="max-w-[750px]"]')).not.toBeNull();
    expect(container.querySelector('[class*="max-w-[1000px]"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Open chat");
    expect(container.textContent).not.toContain("Also");
    expect(container.textContent).not.toContain("active");
    expect(container.textContent).not.toContain(
      "Summarize the current workspace health",
    );
    expect(container.textContent).toContain(
      "Create an app for onboarding requests",
    );
    expect(container.textContent).toContain(
      "Check which agents can help with analytics",
    );
    expect(container.querySelector("nav")).toBeNull();
    expect(
      container.querySelector('[data-placeholder="Ask Dispatch anything..."]'),
    ).not.toBeNull();
    expect(clientState.useChatModels).toHaveBeenCalledWith({
      storageKey: "agent-native:chat-models:selection:dispatch",
    });
    expect(clientState.promptComposerProps).toMatchObject({
      availableModels: [],
      draftScope: "dispatch:overview:org-a",
      modelListLoading: false,
      selectedEffort: "medium",
      selectedEngine: "",
      selectedModel: "auto",
      rootClassName: "bg-card",
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-placeholder]")?.click();
    });

    expect(clientState.navigateWithTransition).toHaveBeenCalledWith(
      expect.any(Function),
      "/chat",
      expect.objectContaining({
        state: {
          dispatchPrompt: expect.objectContaining({
            message: "Route onboarding work",
            selectedModel: "auto",
            selectedEngine: "",
            selectedEffort: "medium",
          }),
        },
      }),
    );
  });

  it("keeps overview submissions on Dispatch Chat inside Builder frames", async () => {
    clientState.inBuilderFrame = true;

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/overview"]}>
          <TooltipProvider>
            <QueryClientProvider client={queryClient}>
              <DispatchControlPlane />
            </QueryClientProvider>
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-placeholder]")?.click();
    });

    expect(clientState.navigateWithTransition).toHaveBeenCalledWith(
      expect.any(Function),
      "/chat",
      expect.objectContaining({
        state: {
          dispatchPrompt: expect.objectContaining({
            message: "Route onboarding work",
          }),
        },
      }),
    );
  });

  it("keeps overview drafts isolated by active organization", async () => {
    const renderOverview = async () => {
      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={["/overview"]}>
            <TooltipProvider>
              <QueryClientProvider client={queryClient}>
                <DispatchControlPlane />
              </QueryClientProvider>
            </TooltipProvider>
          </MemoryRouter>,
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };

    await renderOverview();
    expect(clientState.promptComposerProps).toMatchObject({
      draftScope: "dispatch:overview:org-a",
    });

    clientState.activeOrgId = "org-b";
    await renderOverview();
    expect(clientState.promptComposerProps).toMatchObject({
      draftScope: "dispatch:overview:org-b",
    });

    clientState.activeOrgId = null;
    await renderOverview();
    expect(clientState.promptComposerProps).toMatchObject({
      draftScope: "dispatch:overview",
    });
  });

  it("shows mounted and connected apps together without duplicates", async () => {
    clientState.workspaceApps = [
      {
        id: "onboarding",
        name: "Onboarding",
        path: "/onboarding",
        status: "ready",
        isDispatch: false,
      },
      {
        id: "dispatch",
        name: "Dispatch",
        path: "/dispatch",
        status: "ready",
        isDispatch: true,
      },
      {
        id: "archived-app",
        name: "Archived app",
        path: "/archived-app",
        status: "ready",
        isDispatch: false,
        archived: true,
      },
    ];
    clientState.connectedApps = [
      {
        id: "mail",
        name: "Mail",
        description: "Email client",
        url: "https://mail.agent-native.com",
      },
      {
        id: "clips",
        name: "Clips",
        description: "Record and share",
        url: "https://clips.agent-native.com/share/WrA8ZQ3oxa2T?ref=clip_share",
        homeUrl: "https://clips.agent-native.com",
        source: "builtin",
      },
      {
        id: "onboarding",
        name: "Duplicate onboarding",
        url: "https://duplicate.example.com",
      },
    ];
    clientState.curatedTemplates = [
      {
        id: "mail",
        name: "Mail",
        description: "Email client",
        liveUrl: "https://mail.agent-native.com",
        installed: false,
      },
      {
        id: "analytics",
        name: "Analytics",
        description: "Workspace insights",
        liveUrl: "https://analytics.agent-native.com",
        installed: false,
      },
    ];

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/overview"]}>
          <TooltipProvider>
            <QueryClientProvider client={queryClient}>
              <DispatchControlPlane />
            </QueryClientProvider>
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Onboarding");
    expect(container.textContent).toContain("Mail");
    expect(container.textContent).toContain("Clips");
    expect(container.textContent).toContain("Analytics");
    expect(container.textContent).toContain("Apps");
    expect(container.textContent).toContain("New");
    expect(
      container.querySelector('input[placeholder="Search apps"]'),
    ).not.toBeNull();
    const viewAllLink = Array.from(container.querySelectorAll("a")).find(
      (link) => link.textContent?.trim() === "View all",
    );
    expect(viewAllLink?.className).toContain("text-muted-foreground");
    expect(container.textContent).not.toContain("Other apps");
    expect(container.textContent).not.toContain("available");
    expect(container.textContent).not.toContain("Archived app");
    expect(container.textContent).not.toContain("Duplicate onboarding");
    expect(container.textContent).not.toContain("CRM");
    expect(
      container.querySelectorAll(
        'button[aria-label="Open options for Onboarding"]',
      ),
    ).toHaveLength(1);
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Open options for Onboarding"]',
        )
        ?.dispatchEvent(
          new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
        );
    });
    const onboardingNewTabLink = document.querySelector<HTMLAnchorElement>(
      'a[href="/onboarding"][target="_blank"]',
    );
    expect(onboardingNewTabLink).not.toBeNull();
    const clipsHref = Array.from(container.querySelectorAll("a"))
      .map((anchor) => anchor.getAttribute("href"))
      .find((href) => href?.includes("clips.agent-native.com"));
    expect(clipsHref).toContain("https://clips.agent-native.com");
    expect(clipsHref).not.toContain("/share/");
  });

  it("searches available apps case-insensitively before showing the empty state", async () => {
    clientState.workspaceApps = [
      {
        id: "analytics",
        name: "Analytics",
        path: "/analytics",
        status: "ready",
        isDispatch: false,
      },
    ];
    clientState.curatedTemplates = [
      {
        id: "brain",
        name: "Brain",
        description: "Search cited company knowledge",
        liveUrl: "https://brain.agent-native.com",
        installed: false,
      },
      {
        id: "assets",
        name: "Assets",
        description: "Manage brand assets",
        liveUrl: "https://assets.agent-native.com",
        installed: false,
      },
    ];

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/overview"]}>
          <TooltipProvider>
            <QueryClientProvider client={queryClient}>
              <DispatchControlPlane />
            </QueryClientProvider>
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    await searchApps("Brain");
    expect(container.textContent).toContain("Brain");
    expect(container.textContent).not.toContain("Assets");
    expect(container.textContent).not.toContain("No apps match your search");

    await searchApps("brain");
    expect(container.textContent).toContain("Brain");
    expect(container.textContent).not.toContain("Assets");

    await searchApps("missing app");
    expect(container.textContent).toContain("No apps match your search");
    expect(container.textContent).not.toContain("Brain");
  });
});
