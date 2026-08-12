// @vitest-environment happy-dom
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
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  navigateWithAgentChatViewTransition: (
    navigate: unknown,
    path: string,
    options?: unknown,
  ) => clientState.navigateWithTransition(navigate, path, options),
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

vi.mock("@agent-native/core/client/host", () => ({
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

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    clientState.inBuilderFrame = false;
    clientState.navigateWithTransition.mockReset();
    clientState.promptComposerProps = null;
    clientState.workspaceApps = [];
    clientState.connectedApps = [];
    clientState.curatedTemplates = [];
    clientState.useChatModels.mockClear();
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
            <DispatchControlPlane />
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
    expect(container.querySelector("nav")).toBeNull();
    expect(
      container.querySelector('[data-placeholder="Ask Dispatch anything..."]'),
    ).not.toBeNull();
    expect(clientState.useChatModels).toHaveBeenCalledWith({
      storageKey: "dispatch",
    });
    expect(clientState.promptComposerProps).toMatchObject({
      availableModels: [],
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
            <DispatchControlPlane />
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
            <DispatchControlPlane />
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
    expect(container.textContent).not.toContain("Other apps");
    expect(container.textContent).not.toContain("available");
    expect(container.textContent).not.toContain("Archived app");
    expect(container.textContent).not.toContain("Duplicate onboarding");
    expect(container.textContent).not.toContain("CRM");
    expect(
      Array.from(container.querySelectorAll("a")).filter((anchor) =>
        anchor.getAttribute("href")?.includes("onboarding"),
      ),
    ).toHaveLength(1);
    const clipsHref = Array.from(container.querySelectorAll("a"))
      .map((anchor) => anchor.getAttribute("href"))
      .find((href) => href?.includes("clips.agent-native.com"));
    expect(clipsHref).toContain("https://clips.agent-native.com");
    expect(clipsHref).not.toContain("/share/");
  });
});
