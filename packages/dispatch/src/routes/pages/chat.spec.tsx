// @vitest-environment happy-dom
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatRoute from "./chat";

const clientState = vi.hoisted(() => ({
  surfaceProps: null as Record<string, unknown> | null,
  openWorkspaceApp: vi.fn(),
  workspaceApps: [
    {
      id: "content",
      name: "Content",
      description: "Create and edit content",
      path: "/content",
    },
  ],
  workspaceAppsError: null as unknown,
  retryWorkspaceApps: vi.fn(),
  agents: [] as Array<{
    id: string;
    name: string;
    description: string | null;
    path: string;
    content: string;
    scope: "all" | "selected";
    updatedAt: number;
  }>,
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  insertAgentComposerReference: vi.fn(),
  markAgentChatHomeHandoff: vi.fn(),
  readChatFirstMode: () => true,
  navigateWithAgentChatViewTransition: (
    navigate: (path: string) => void,
    path: string,
  ) => navigate(path),
  sendToAgentChat: vi.fn(),
}));

vi.mock("@agent-native/toolkit/app/chat", () => ({
  AgentChatHome: (props: Record<string, unknown>) => {
    clientState.surfaceProps = { mode: "page", ...props };
    return (
      <>
        {props.homeIntroSlot as ReactNode}
        {props.afterComposerSlot as ReactNode}
      </>
    );
  },
}));

vi.mock("../../components/create-app-popover", () => ({
  CreateAppPopover: () => null,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({
    data: clientState.agents,
    error: null,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("../../components/layout/Layout", () => ({
  dispatchNavLinkTarget: (path: string) => path,
  useDispatchExtensions: () => undefined,
  useDispatchWorkspaceAppLauncher: () => ({
    apps: clientState.workspaceApps,
    workspaceApps: clientState.workspaceApps,
    isLoading: false,
    error: clientState.workspaceAppsError,
    openApp: clientState.openWorkspaceApp,
    retry: clientState.retryWorkspaceApps,
  }),
}));

vi.mock("../../lib/workspace-app-layout", () => ({
  workspaceAppMatchesQuery: (
    app: { name: string; description?: string },
    query: string,
  ) => `${app.name} ${app.description ?? ""}`.toLowerCase().includes(query),
  orderWorkspaceApps: (apps: unknown[]) => apps,
  useWorkspaceAppLayout: () => ({
    layout: { pinnedIds: [], orderedIds: [] },
    togglePinned: vi.fn(),
  }),
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
  appApiPath: (path: string) => path,
  appBasePath: () => "",
  appPath: (path: string) => path,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT:
    () => (key: string, values?: { defaultValue?: string; name?: string }) =>
      values?.defaultValue ??
      (key === "dispatch.pages.chatFirstWorkspaceApps"
        ? "Workspace apps"
        : key === "dispatch.pages.chatFirstOpenApp"
          ? `Open ${values?.name}`
          : key === "extensions.optionsFor"
            ? `Options for ${values?.name}`
            : key),
}));

describe("Dispatch ChatRoute", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    clientState.surfaceProps = null;
    clientState.agents = [];
    clientState.openWorkspaceApp.mockReset();
    clientState.retryWorkspaceApps.mockReset();
    clientState.workspaceAppsError = null;
    clientState.workspaceApps = [
      {
        id: "content",
        name: "Content",
        description: "Create and edit content",
        path: "/content",
      },
    ];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps the centered hero layout for a direct new Chat", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatRoute />
        </MemoryRouter>,
      );
    });

    expect(clientState.surfaceProps).toMatchObject({
      mode: "page",
      chatViewTransition: true,
      centerComposerWhenEmpty: true,
      composerLayoutVariant: "hero",
      composerPlaceholder: "Tell Dispatch what you’d like to make happen…",
      suppressInlineOpenApp: true,
    });
    expect(container.textContent).toContain("What should we do today?");
    expect(clientState.surfaceProps?.suggestions).toEqual([
      "dispatch.pages.suggestionWorkspaceHealth",
      "dispatch.pages.suggestionOnboardingApp",
      "dispatch.pages.suggestionAnalyticsAgents",
    ]);
    expect(clientState.surfaceProps?.afterComposerSlot).toBeTruthy();
  });

  it("renders the colored app directory below the empty chat composer", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatRoute />
        </MemoryRouter>,
      );
    });

    const appButton = container.querySelector<HTMLButtonElement>(
      "button[aria-label='Open Content']",
    );
    expect(appButton).toBeTruthy();
    expect(
      container.querySelector("article span[style]")?.getAttribute("style"),
    ).toContain("16 185 129");

    await act(async () => {
      appButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(clientState.openWorkspaceApp).toHaveBeenCalledWith(
      expect.objectContaining({ id: "content", name: "Content" }),
    );
  });

  it("keeps loaded apps visible and offers retry after a partial list failure", async () => {
    clientState.workspaceAppsError = new Error("grant app list unavailable");

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatRoute />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Content");
    expect(container.textContent).toContain("dispatch.pages.dataLoadFailed");
    const retryButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("dispatch.pages.tryAgain"),
    );
    expect(retryButton).toBeTruthy();

    await act(async () => {
      retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(clientState.retryWorkspaceApps).toHaveBeenCalledOnce();
  });

  it("starts bottom-pinned when an Overview prompt is transitioning in", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={[
            {
              pathname: "/chat",
              state: {
                dispatchPrompt: {
                  id: "overview-prompt",
                  message: "Route this across my apps",
                  selectedModel: "auto",
                },
              },
            },
          ]}
        >
          <ChatRoute />
        </MemoryRouter>,
      );
    });

    expect(clientState.surfaceProps).toHaveProperty(
      "centerComposerWhenEmpty",
      false,
    );
    expect(clientState.surfaceProps).toHaveProperty(
      "composerLayoutVariant",
      "default",
    );
    expect(clientState.surfaceProps).toHaveProperty(
      "suppressInlineOpenApp",
      true,
    );
    expect(clientState.surfaceProps?.suggestions).toEqual([]);
    expect(container.textContent).not.toContain("What should we do today?");

    await act(async () => {
      vi.runOnlyPendingTimers();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("What should we do today?");
  });

  it("keeps an agent chat scoped and preserves the scope in thread URLs", async () => {
    clientState.agents = [
      {
        id: "agent-1",
        name: "Research Partner",
        description: "Synthesizes research",
        path: "agents/research-partner.md",
        content: "instructions",
        scope: "all",
        updatedAt: 1,
      },
    ];

    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={["/chat?agent=agents/research-partner.md"]}
        >
          <ChatRoute />
        </MemoryRouter>,
      );
    });

    expect(clientState.surfaceProps).toMatchObject({
      scope: {
        type: "agent",
        id: "agent-1",
        label: "Research Partner",
      },
      storageKey: "dispatch-agent-agent-1",
      composerPlaceholder: "Ask Research Partner...",
    });
    expect(
      (
        clientState.surfaceProps?.threadUrlSync as {
          getPath: (id: string) => string;
        }
      ).getPath("thread-1"),
    ).toBe("/chat/thread-1?agent=agents%2Fresearch-partner.md");
  });

  it("keeps threaded chats free of request ID chrome", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat/chat-123"]}>
          <ChatRoute />
        </MemoryRouter>,
      );
    });

    expect(clientState.surfaceProps?.suggestions).toEqual([]);
    expect(clientState.surfaceProps?.contentClassName).toBe("max-w-none");
    expect(container.textContent).not.toContain("Request ID");
  });
});
