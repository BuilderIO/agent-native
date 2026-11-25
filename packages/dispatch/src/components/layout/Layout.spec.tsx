import {
  emitChatFirstOpenApp,
  getChatFirstSurfaceTabsStore,
  reportAgentChatComposerSubmit,
  withdrawAgentChatComposerSubmit,
} from "@agent-native/core/client/agent-chat";
import { isSettingsPathname } from "@agent-native/toolkit/app/settings";
// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetWorkspaceAppLayoutStoreForTests } from "../../lib/workspace-app-layout";
import { CHAT_FIRST_PANE_STATE_KEY } from "../../shared/chat-first-pane";
import { AdminShell } from "../admin-navigation";
import { Tooltip, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import {
  buildChatFirstEmbedSessionInput,
  CHAT_FIRST_SURFACE_PANEL_TOGGLE_CLASS_NAME,
  dispatchNavLinkTarget,
  isElectronEmbeddedSearch,
  isRedesignedSettingsPath,
  Layout,
  NavContent,
  renderChatFirstAppSurfaceTab,
  shouldAutoCollapseDispatchSidebar,
  shouldQueryChatFirstApps,
} from "./Layout";

const clientState = vi.hoisted(() => ({
  createThread: vi.fn<() => Promise<string | null>>(),
  switchThread: vi.fn(),
  renameThread: vi.fn().mockResolvedValue(true),
  pinThread: vi.fn().mockResolvedValue(true),
  archiveThread: vi.fn().mockResolvedValue(true),
  isNewThread: () => false,
  mineThreads: null as Array<Record<string, unknown>> | null,
  sharedThreads: [] as Array<Record<string, unknown>>,
  sharedHasMore: false,
  loadMore: vi.fn().mockResolvedValue(undefined),
  listQueries: vi.fn(),
  lifecycleOptions: vi.fn(),
  threads: [] as Array<Record<string, unknown>>,
  workspaceApps: [] as Array<Record<string, unknown>>,
  workspaceAppsError: null as Error | null,
  workspaceAppsLoading: false,
  connectedApps: [] as Array<Record<string, unknown>>,
  connectedAppsError: null as Error | null,
  connectedAppsLoading: false,
  railRenders: 0,
  appState: {} as Record<string, unknown>,
  appStatePromises: {} as Record<string, Promise<unknown>>,
  basePath: "",
  createEmbedSessionMutateAsync: vi
    .fn()
    .mockResolvedValue({ startUrl: "about:blank" }),
  callAction: vi.fn(
    async (
      _name: string,
      _params?: unknown,
      _options?: unknown,
    ): Promise<unknown> => ({ status: "ok", app: "none", confidence: 1 }),
  ),
}));
const workspaceAppNavigation = vi.hoisted(() => ({
  navigateToWorkspaceApp: vi.fn((_href: string) => true),
}));

vi.mock("../../lib/workspace-apps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/workspace-apps")>()),
  navigateToWorkspaceApp: workspaceAppNavigation.navigateToWorkspaceApp,
}));

vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  navigateWithAgentChatViewTransition: (
    navigate: (path: string) => void,
    path: string,
  ) => navigate(path),
  useAgentChatHomeHandoff: () => false,
  useAgentChatHomeHandoffLinks: vi.fn(),
  useChatModels: () => ({
    availableModels: [],
    defaultModel: "auto",
    selectedModel: "auto",
    selectedEngine: "",
    selectedEffort: "medium" as const,
    isLoading: false,
    onModelChange: vi.fn(),
    onEffortChange: vi.fn(),
    refreshEngines: vi.fn(),
  }),
  useChatThreadList: (options: {
    ownership: string;
    includeExternal?: boolean;
  }) => {
    clientState.listQueries(options);
    return {
      threads:
        options.ownership === "shared"
          ? clientState.sharedThreads
          : (clientState.mineThreads ?? clientState.threads),
      loading: false,
      loadingMore: false,
      error: null,
      hasMore: options.ownership === "shared" && clientState.sharedHasMore,
      loadMore: clientState.loadMore,
      refresh: async () => {},
      refreshWithResult: async () => "success",
    };
  },
  useChatThreads: (...args: unknown[]) => {
    clientState.lifecycleOptions(args[3]);
    return {
      threads: clientState.threads,
      activeThreadId: "active-thread",
      isLoading: false,
      createThread: clientState.createThread,
      switchThread: clientState.switchThread,
      renameThread: clientState.renameThread,
      pinThread: clientState.pinThread,
      archiveThread: clientState.archiveThread,
      isNewThread: clientState.isNewThread,
      refreshThreads: vi.fn(),
    };
  },
  useChatModels: () => ({
    availableModels: [],
    defaultModel: "auto",
    selectedModel: "auto",
    selectedEngine: "auto",
    selectedEffort: "medium",
    setSelectedModel: vi.fn(),
  }),
}));

vi.mock(
  "@agent-native/toolkit/app/chat/ownership-history",
  async () =>
    import("../../../../toolkit/src/app/chat/ownership-history/index.tsx"),
);

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@agent-native/toolkit/app/chat/AgentSidebar", () => ({
  AgentToggleButton: () => null,
  AgentSidebar: ({ children }: { children: React.ReactNode }) => (
    <div data-agent-sidebar>{children}</div>
  ),
  focusAgentChat: vi.fn(),
}));

vi.mock("../deferred-chat-components.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../deferred-chat-components.js")>()),
  AgentChatSurface: () => null,
  ChatFirstAppsRail: await (async () => {
    const { createElement, memo } = await import("react");
    const { ChatFirstAppsRail: Rail } =
      await import("../../../../toolkit/src/app/chat/chat-first/apps-rail.tsx");
    return memo(function CountedRail(props: Parameters<typeof Rail>[0]) {
      clientState.railRenders += 1;
      return createElement(Rail, props);
    });
  })(),
  ChatFirstChatHistory: (
    await import("../../../../toolkit/src/app/chat/chat-first/chat-history.tsx")
  ).ChatFirstChatHistory,
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
  appBasePath: () => clientState.basePath,
  appMountPath: () => "",
  appMountedPath: (path: string) => path,
  appPath: (path: string) =>
    clientState.basePath && path.startsWith("/")
      ? `${clientState.basePath}${path}`
      : path,
  frameworkRoutePrefix: () => "",
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useActionQuery: (action: string) => {
    const workspaceAppsQuery = action === "list-workspace-apps";
    const connectedAppsQuery = action === "list-connected-agents";
    const error = workspaceAppsQuery
      ? clientState.workspaceAppsError
      : connectedAppsQuery
        ? clientState.connectedAppsError
        : null;
    return {
      data: workspaceAppsQuery
        ? clientState.workspaceApps
        : connectedAppsQuery
          ? clientState.connectedApps
          : undefined,
      error,
      isError: Boolean(error),
      isLoading: workspaceAppsQuery
        ? clientState.workspaceAppsLoading
        : connectedAppsQuery
          ? clientState.connectedAppsLoading
          : false,
    };
  },
  useActionMutation: () => ({
    mutateAsync: clientState.createEmbedSessionMutateAsync,
  }),
  callAction: (name: string, params?: unknown, options?: unknown) =>
    clientState.callAction(name, params, options),
}));

vi.mock(
  "@agent-native/core/client/application-state",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/core/client/application-state")
    >()),
    readClientAppState: async (key: string) =>
      (await clientState.appStatePromises[key]) ??
      clientState.appState[key] ??
      null,
    writeClientAppState: async (key: string, value: unknown) => {
      clientState.appState[key] = value;
      return value;
    },
  }),
);

vi.mock("@agent-native/core/client/feature-flags", () => ({
  useFeatureFlag: () => false,
  useFeatureFlagState: () => ({ enabled: false, status: "ready" }),
}));

vi.mock("../../hooks/use-mobile", () => ({ useIsMobile: () => false }));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  DEFAULT_LOCALE: "en-US",
  useOptionalLocale: () => ({ locale: "en-US" }),
  useFormatters: () => ({ formatNumber: (value: number) => String(value) }),
  // Stable like the real useT, so memoized copy stays memoized.
  useT: () => translate,
}));

function translate(key: string, values?: Record<string, unknown>) {
  const messages: Record<string, string> = {
    "dispatch.nav.chat": "Chat",
    "dispatch.nav.overview": "Overview",
    "dispatch.nav.apps": "Apps",
    "dispatch.nav.agents": "Agents",
    "dispatch.pages.workspaceApps": "Workspace apps",
    "dispatch.nav.operate": "Operate",
    "dispatch.nav.advanced": "Advanced",
    "agentChat.history.mine": "My chats",
    "agentChat.history.sharedWithYou": "Shared with you",
    "agentChat.history.ownedBy": `Owner: ${values?.name ?? ""}`,
    "agentChat.history.accessDirect": "Shared with you",
    "agentChat.history.accessOrganization": "Shared with your organization",
    "agentChat.history.copyLink": "Copy link",
    "agentChat.history.onlyYou": "Only you",
    "agentChat.history.hide": "Hide from my list",
    "agentChat.history.showAll": "Show all",
    "agentChat.history.showLess": "Show less",
    "agentChat.history.loadMore": "Load more",
    "agentChat.history.loadingMore": "Loading...",
    "agentChat.history.emptyMine": "No chats yet",
    "dispatch.sidebar.chats": "Chats",
    "dispatch.sidebar.showLocalChats": "Show local chats",
    "dispatch.sidebar.showAllChats": "Show all chats",
    "agentChat.contextXray.pin": "Pin",
    "agentChat.contextXray.unpin": "Unpin",
    "extensions.delete": "Archive",
    "dispatch.integrations.failedToSave": "Failed to save",
    "dispatch.sidebar.newChat": "New chat",
    "dispatch.sidebar.newDispatchChat": "New Dispatch chat",
    "dispatch.sidebar.renameChat": "Rename chat",
    "dispatch.sidebar.chatOptions": `Options for ${values?.title ?? ""}`,
    "dispatch.sidebar.renameThread": `Rename ${values?.title ?? ""}`,
    "agentChat.chatFirst.showMoreCount": `${values?.count ?? ""} more apps`,
    "sidebar.collapseSidebar": "Collapse sidebar",
    "sidebar.expandSidebar": "Expand sidebar",
  };
  return messages[key] ?? String(values?.defaultValue ?? key);
}

vi.mock("@agent-native/toolkit/app/shared", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/toolkit/app/shared")
  >()),
  openCommandMenu: vi.fn(),
}));

vi.mock("../create-app-popover", () => ({
  CreateAppPopover: () => null,
}));

vi.mock("@agent-native/toolkit/app/feedback", () => ({
  FeedbackButton: () => <div>Feedback</div>,
}));

vi.mock("@agent-native/toolkit/app/org", () => ({
  InvitationBanner: () => null,
  OrgSwitcher: () => <div>Organization</div>,
}));

function LocationProbe({ onChange }: { onChange: (path: string) => void }) {
  const location = useLocation();
  React.useEffect(() => {
    onChange(location.pathname);
  }, [location.pathname, onChange]);
  return null;
}

function ChatRouteSwitcher({ target }: { target: string }) {
  const navigate = useNavigate();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void navigate(target);
        }}
      >
        Switch chat
      </button>
      <button
        type="button"
        onClick={() => {
          void navigate(-1);
        }}
      >
        Go back
      </button>
    </>
  );
}

describe("Dispatch navigation paths", () => {
  afterEach(() => {
    clientState.basePath = "";
    vi.unstubAllGlobals();
  });

  it("keeps router-prefixed paths local and applies the mount prefix otherwise", () => {
    clientState.basePath = "/dispatch";
    vi.stubGlobal("window", { location: { pathname: "/dispatch/chat" } });
    expect(dispatchNavLinkTarget("/apps")).toBe("/apps");

    vi.stubGlobal("window", { location: { pathname: "/chat" } });
    expect(dispatchNavLinkTarget("/apps")).toBe("/dispatch/apps");
  });
});

describe("chat-first embed sessions", () => {
  it("keeps the granted app id on app-relative embed requests", () => {
    expect(buildChatFirstEmbedSessionInput("mail", "/mail/inbox")).toEqual({
      app: "mail",
      path: "/mail/inbox",
      chrome: "minimal",
    });
  });
});

describe("Electron control-plane mode", () => {
  it("recognizes only the explicit Electron query flag", () => {
    expect(isElectronEmbeddedSearch("?electron=1")).toBe(true);
    expect(isElectronEmbeddedSearch("?electron=0")).toBe(false);
    expect(isElectronEmbeddedSearch("?chatFirst=1")).toBe(false);
  });
});

describe("Dispatch workspace app sidebar", () => {
  it("auto-collapses for app host routes but not the app catalog", () => {
    expect(shouldAutoCollapseDispatchSidebar("/apps/mail")).toBe(true);
    expect(shouldAutoCollapseDispatchSidebar("/apps/mail/settings")).toBe(true);
    expect(shouldAutoCollapseDispatchSidebar("/apps")).toBe(false);
    expect(shouldAutoCollapseDispatchSidebar("/chat")).toBe(false);
  });

  it.each([
    [false, false, false],
    [false, true, true],
    [true, false, true],
  ])(
    "queries app data for a chat route or visible chat-first rail",
    (isChatRoute, chatFirstMode, expected) => {
      expect(shouldQueryChatFirstApps(isChatRoute, chatFirstMode)).toBe(
        expected,
      );
    },
  );
});

describe("Dispatch Settings frame", () => {
  it("drops the Dispatch chrome on Settings", () => {
    const settingsEnabled = { enabled: true, status: "ready" } as const;
    expect(isRedesignedSettingsPath("/settings", settingsEnabled)).toBe(true);
    expect(isRedesignedSettingsPath("/settings/members", settingsEnabled)).toBe(
      true,
    );
    expect(isRedesignedSettingsPath("/settings/app", settingsEnabled)).toBe(
      true,
    );
    expect(
      isRedesignedSettingsPath("/settings", {
        enabled: false,
        status: "loading",
      }),
    ).toBe(true);
  });

  it("keeps the Dispatch chrome off Settings", () => {
    const settingsEnabled = { enabled: true, status: "ready" } as const;
    expect(isRedesignedSettingsPath("/admin", settingsEnabled)).toBe(false);
    expect(
      isRedesignedSettingsPath("/apps/mail/settings", settingsEnabled),
    ).toBe(false);
    expect(
      isRedesignedSettingsPath("/settings", {
        enabled: false,
        status: "unavailable",
      }),
    ).toBe(false);
  });
});

describe("Dispatch NavContent", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    clientState.createThread.mockResolvedValue("new-thread");
    clientState.switchThread.mockReset();
    clientState.createThread.mockClear();
    clientState.renameThread.mockReset().mockResolvedValue(true);
    clientState.pinThread.mockReset().mockResolvedValue(true);
    clientState.archiveThread.mockReset().mockResolvedValue(true);
    clientState.sharedThreads = [];
    clientState.mineThreads = null;
    clientState.sharedHasMore = false;
    clientState.loadMore.mockClear();
    clientState.listQueries.mockClear();
    clientState.lifecycleOptions.mockClear();
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
    );
    clientState.threads = [
      {
        ownerEmail: "probe@example.com",
        accessBasis: "owner",
        visibility: "private",
        id: "active-thread",
        title: "Current Dispatch work",
        messageCount: 2,
        updatedAt: Date.now(),
        createdAt: Date.now(),
      },
      {
        ownerEmail: "probe@example.com",
        accessBasis: "owner",
        visibility: "private",
        id: "older-thread",
        title: "Earlier Dispatch work",
        messageCount: 1,
        updatedAt: Date.now() - 5 * 60_000,
        createdAt: Date.now() - 5 * 60_000,
        source: { platform: "slack", url: "https://example.slack.com/thread" },
      },
    ];
    clientState.workspaceApps = [];
    clientState.workspaceAppsError = null;
    clientState.workspaceAppsLoading = false;
    clientState.connectedApps = [];
    clientState.connectedAppsError = null;
    clientState.connectedAppsLoading = false;
    clientState.appState = {};
    clientState.appStatePromises = {};
    resetWorkspaceAppLayoutStoreForTests();
    workspaceAppNavigation.navigateToWorkspaceApp.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("provides tooltip context to chrome-less route content", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/approval"]}>
          <Layout>
            <Tooltip open>
              <TooltipTrigger asChild>
                <button type="button">Approval details</button>
              </TooltipTrigger>
            </Tooltip>
          </Layout>
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Approval details");
  });

  it("provides tooltip context to embedded workspace app content", async () => {
    window.history.replaceState({}, "", "/apps/mail?embedded=1");
    try {
      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={["/apps/mail"]}>
            <Layout>
              <Tooltip open>
                <TooltipTrigger asChild>
                  <button type="button">Embedded app details</button>
                </TooltipTrigger>
              </Tooltip>
            </Layout>
          </MemoryRouter>,
        );
      });

      expect(
        container.querySelector("[data-dispatch-workspace-app-chrome-less]"),
      ).not.toBeNull();
      expect(container.textContent).toContain("Embedded app details");
    } finally {
      window.history.replaceState({}, "", "/");
    }
  });

  it("takes the sidebar toggle from the active kept-alive app, not an earlier retained one", async () => {
    const install = (app: string) => ({
      id: app,
      name: app,
      path: `/${app}`,
      url: `https://${app}.example.test/${app}`,
      status: "ready",
    });
    clientState.workspaceApps = [install("mail"), install("calendar")];
    for (const app of ["calendar", "mail"]) {
      clientState.createEmbedSessionMutateAsync.mockResolvedValueOnce({
        startUrl: `https://${app}.example.test/${app}/initial`,
        childBrowserTabId:
          app === "mail"
            ? "d178e672-918b-4c93-bd78-f627f7f00001"
            : "d178e672-918b-4c93-bd78-f627f7f00002",
      });
    }
    const toggles = vi.fn();
    window.addEventListener("agent-panel:toggle", toggles);
    try {
      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={["/apps/calendar"]}>
            <Layout>
              <div />
            </Layout>
          </MemoryRouter>,
        );
      });
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            'button[data-chat-first-app][data-app-id="mail"]',
          )
          ?.click();
      });

      const frameOf = (app: string) => {
        const frame = container.querySelector<HTMLIFrameElement>(
          `[data-dispatch-workspace-app-cache-entry="${app}"] iframe`,
        );
        if (!frame?.contentWindow) throw new Error(`Missing ${app} iframe`);
        return frame;
      };
      const retained = frameOf("calendar");
      const active = frameOf("mail");
      expect(
        retained
          .closest("[data-dispatch-workspace-app-cache-entry]")
          ?.getAttribute("aria-hidden"),
      ).toBe("true");
      const post = async (frame: HTMLIFrameElement) =>
        act(async () => {
          window.dispatchEvent(
            new MessageEvent("message", {
              data: { type: "agentNative.toggleSidebar", data: {} },
              source: frame.contentWindow,
            }),
          );
        });

      await post(retained);
      expect(toggles).not.toHaveBeenCalled();
      await post(active);
      expect(toggles).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("agent-panel:toggle", toggles);
    }
  });

  it("opens mounted apps when optional connected-app discovery fails", async () => {
    clientState.workspaceApps = [
      {
        id: "mail",
        name: "Mail",
        path: "/mail",
        url: "/mail",
        status: "ready",
      },
    ];
    clientState.connectedAppsError = new Error("Connected apps unavailable");

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat/mounted-optional-error"]}>
          <Layout extensions={{ chatFirst: true }}>
            <div />
          </Layout>
        </MemoryRouter>,
      );
    });

    await act(async () => {
      emitChatFirstOpenApp({ app: "mail" });
    });

    expect(
      container.querySelector("[data-chat-first-app-pane]"),
    ).not.toBeNull();
  });

  it("opens a loaded mounted app while optional built-in discovery is loading", async () => {
    clientState.workspaceApps = [
      {
        id: "mail",
        name: "Mail",
        path: "/mail",
        url: "/mail",
        status: "ready",
      },
    ];
    clientState.connectedAppsLoading = true;

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat/mounted-while-loading"]}>
          <Layout extensions={{ chatFirst: true }}>
            <div />
          </Layout>
        </MemoryRouter>,
      );
    });

    await act(async () => {
      emitChatFirstOpenApp({ app: "mail" });
    });

    expect(
      container.querySelector("[data-chat-first-app-pane]"),
    ).not.toBeNull();
  });

  it("shows an app opened beside the chat instead of leaving it hidden", async () => {
    clientState.workspaceApps = [
      {
        id: "mail",
        name: "Mail",
        path: "/mail",
        url: "/mail",
        status: "ready",
      },
    ];

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat/side-app-visible"]}>
          <Layout extensions={{ chatFirst: true }}>
            <div />
          </Layout>
        </MemoryRouter>,
      );
    });
    await act(async () => {
      emitChatFirstOpenApp({ app: "mail" });
    });

    const wrapper = container
      .querySelector("[data-chat-first-app-pane]")
      ?.closest("[data-chat-first-surface-content]");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.getAttribute("aria-hidden")).toBe("false");
    expect(wrapper?.className).not.toContain("hidden");
  });

  it("opens the exact Fleet installation despite an earlier template with the same name", async () => {
    clientState.workspaceApps = [
      {
        id: "fleet-2",
        name: "Fleet",
        path: "/fleet-2",
        url: "/fleet-2",
        source: "builtin",
        status: "ready",
      },
      {
        id: "fleet",
        name: "Fleet",
        path: "/fleet",
        url: "/fleet",
        source: "workspace",
        status: "ready",
      },
    ];
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat/fleet-installation"]}>
          <Layout extensions={{ chatFirst: true }}>
            <div />
          </Layout>
        </MemoryRouter>,
      );
    });
    await act(async () => {
      emitChatFirstOpenApp({ app: "fleet" });
    });
    expect(
      getChatFirstSurfaceTabsStore("fleet-installation").getSnapshot().tabs,
    ).toMatchObject([{ appId: "fleet" }]);
  });

  it("opens the app Dispatch delegates to, once", async () => {
    clientState.workspaceApps = [
      {
        id: "mail",
        name: "Mail",
        path: "/mail",
        url: "/mail",
        status: "ready",
      },
    ];

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat/delegation-opens-app"]}>
          <Layout extensions={{ chatFirst: true }}>
            <div />
          </Layout>
        </MemoryRouter>,
      );
    });
    expect(container.querySelector("[data-chat-first-app-pane]")).toBeNull();

    const delegate = () =>
      window.dispatchEvent(
        new CustomEvent("agent-native:tool-start", {
          detail: {
            tool: "call-agent",
            input: { agent: "mail", message: "what is in my inbox" },
          },
        }),
      );
    await act(async () => {
      delegate();
    });
    expect(
      container.querySelector("[data-chat-first-app-pane]"),
    ).not.toBeNull();

    await act(async () => {
      delegate();
    });
    expect(
      container.querySelectorAll("[data-chat-first-surface-content]"),
    ).toHaveLength(1);
  });

  it("keeps an app the agent opens before the new chat has an id", async () => {
    clientState.workspaceApps = [
      {
        id: "mail",
        name: "Mail",
        path: "/mail",
        url: "/mail",
        status: "ready",
      },
    ];

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat"]}>
          <Layout extensions={{ chatFirst: true }}>
            <ChatRouteSwitcher target="/chat/first-turn-id" />
          </Layout>
        </MemoryRouter>,
      );
    });
    await act(async () => {
      emitChatFirstOpenApp({ app: "mail" });
    });
    expect(container.querySelector("[data-chat-first-app-pane]")).toBeNull();

    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Switch chat")
        ?.click();
    });

    expect(
      container.querySelector("[data-chat-first-app-pane]"),
    ).not.toBeNull();
  });

  describe("opening the pane the route picks for a sent message", () => {
    const apps = [
      {
        id: "mail",
        name: "Mail",
        path: "/mail",
        url: "/mail",
        status: "ready",
      },
      {
        id: "notes",
        name: "Notes",
        path: "/notes",
        url: "/notes",
        status: "ready",
      },
    ];
    const appTabs = (scope: string) =>
      getChatFirstSurfaceTabsStore(scope)
        .getSnapshot()
        .tabs.filter((tab) => tab.kind === "app");

    function routeTo(answer: unknown) {
      let settle: (value: unknown) => void = () => undefined;
      clientState.callAction.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            settle = resolve;
          }),
      );
      return {
        answer: () =>
          act(async () => {
            settle(answer);
          }),
      };
    }

    async function send(text: string, previousTurn?: string) {
      await act(async () => {
        reportAgentChatComposerSubmit({ text, previousTurn });
      });
    }

    async function renderChat(
      path: string,
      children: React.ReactNode = null,
      registrations = apps,
    ) {
      clientState.workspaceApps = registrations;
      clientState.callAction.mockClear();
      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={[path]}>
            <Layout extensions={{ chatFirst: true }}>{children}</Layout>
          </MemoryRouter>,
        );
      });
    }

    it("asks the route with the shown app and previous turn, and opens its answer", async () => {
      await renderChat("/chat/route-opens");
      const route = routeTo({
        status: "ok",
        app: "mail",
        confidence: 1,
        explicit: true,
      });
      await send("show my inbox", "User: hi\nAssistant: hello");
      expect(clientState.callAction).toHaveBeenCalledWith(
        "route-app-intent",
        { text: "show my inbox", previousTurn: "User: hi\nAssistant: hello" },
        expect.objectContaining({ timeoutMs: expect.any(Number) }),
      );
      expect(appTabs("route-opens")).toEqual([]);
      await route.answer();
      expect(appTabs("route-opens").map((tab) => tab.appId)).toEqual(["mail"]);

      routeTo({ status: "ok", app: "mail", confidence: 1, explicit: true });
      await send("archive the first one");
      expect(clientState.callAction).toHaveBeenLastCalledWith(
        "route-app-intent",
        expect.objectContaining({ openApp: "mail" }),
        expect.anything(),
      );
    });

    it.each([
      ["a chat-only answer", { status: "ok", app: "none", confidence: 1 }],
      ["an unconfigured route", { status: "not_configured", reason: "x" }],
      ["a failed route", { status: "failed", reason: "x" }],
      [
        "an app that is not installed",
        { status: "ok", app: "planner", confidence: 1 },
      ],
      ["Dispatch itself", { status: "ok", app: "dispatch", confidence: 1 }],
    ])("leaves the pane closed for %s", async (_label, answer) => {
      await renderChat("/chat/route-skips");
      const route = routeTo(answer);
      await send("what changed this week");
      await route.answer();
      expect(appTabs("route-skips")).toEqual([]);
      expect(container.textContent).not.toContain("not opened");
    });

    it("leaves the pane closed when the route call rejects", async () => {
      await renderChat("/chat/route-rejects");
      clientState.callAction.mockRejectedValueOnce(
        Object.assign(new Error("timed out"), { timedOut: true }),
      );
      await send("show my inbox");
      expect(appTabs("route-rejects")).toEqual([]);
    });

    it("drops an answer once a newer message was sent", async () => {
      await renderChat("/chat/route-newer-send");
      const first = routeTo({
        status: "ok",
        app: "mail",
        confidence: 1,
        explicit: true,
      });
      routeTo({ status: "ok", app: "none", confidence: 1 });
      await send("show my inbox");
      await send("never mind, just chat");
      await first.answer();
      expect(appTabs("route-newer-send")).toEqual([]);
    });

    it("drops an answer once the agent already opened a pane", async () => {
      await renderChat("/chat/route-agent-first");
      const route = routeTo({
        status: "ok",
        app: "mail",
        confidence: 1,
        explicit: true,
      });
      await send("show my notes");
      await act(async () => {
        emitChatFirstOpenApp({ app: "notes" });
      });
      await route.answer();
      expect(appTabs("route-agent-first").map((tab) => tab.appId)).toEqual([
        "notes",
      ]);
    });

    it("keeps Tasks offscreen before the authoritative Mail notification handoff", async () => {
      await renderChat("/chat/route-notifications", null, [
        {
          id: "mail-2",
          name: "Mail",
          path: "/mail",
          url: "/mail",
          status: "ready",
        },
        {
          id: "tasks-2",
          name: "Tasks",
          path: "/tasks",
          url: "/tasks",
          status: "ready",
        },
      ]);
      const guess = routeTo({ status: "ok", app: "tasks-2", confidence: 0.95 });
      await send("GitHub notifications from humans");
      await guess.answer();
      expect(appTabs("route-notifications")).toEqual([]);
      expect(container.querySelector("[data-chat-first-app-pane]")).toBeNull();

      const pending = routeTo({
        status: "ok",
        app: "tasks-2",
        confidence: 1,
        explicit: true,
      });
      await send("GitHub notifications from humans, please");
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("agent-native:tool-start", {
            detail: { tool: "open_app", input: { app: "mail-2" } },
          }),
        );
      });
      await pending.answer();
      expect(appTabs("route-notifications")).toEqual([]);
      await act(async () => {
        emitChatFirstOpenApp({ app: "mail-2", path: "/split/github" });
      });
      expect(appTabs("route-notifications")).toMatchObject([
        { appId: "mail-2", path: "/split/github" },
      ]);
    });

    it("reads a refreshed selection only from the visible workspace pane", async () => {
      const install = (app: string) => ({
        id: app,
        name: app,
        path: `/${app}`,
        url: `https://${app}.example.test/${app}`,
        status: "ready",
      });
      await renderChat("/chat/pane-context", null, [
        install("mail"),
        install("notes"),
      ]);

      async function openFrame(app: string, selection: () => string) {
        clientState.createEmbedSessionMutateAsync.mockResolvedValueOnce({
          startUrl: `https://${app}.example.test/${app}/initial`,
          childBrowserTabId:
            app === "mail"
              ? "d178e672-918b-4c93-bd78-f627f7f00001"
              : "d178e672-918b-4c93-bd78-f627f7f00002",
        });
        await act(async () => emitChatFirstOpenApp({ app }));
        const frame = container.querySelector<HTMLIFrameElement>(
          `iframe[src^="https://${app}.example.test/"]`,
        );
        if (!frame?.contentWindow) throw new Error("Missing pane iframe");
        const read = vi
          .spyOn(frame.contentWindow, "postMessage")
          .mockImplementation((request, _origin, transfer) => {
            if (request?.operation !== "read") return;
            const [port] = transfer as MessagePort[];
            port.postMessage({
              result: { path: `/${app}/current`, selectedText: selection() },
            });
            port.close();
          });
        await act(async () => frame.dispatchEvent(new Event("load")));
        return read;
      }

      let selectedMail = "First message";
      const mailRead = await openFrame("mail", () => selectedMail);
      await send("Summarize this");
      await vi.waitFor(() =>
        expect(clientState.callAction).toHaveBeenLastCalledWith(
          "route-app-intent",
          expect.objectContaining({
            openApp: "mail",
            openPath: "/mail/current",
            selection: "First message",
          }),
          expect.anything(),
        ),
      );

      selectedMail = "Edited message";
      await send("Summarize this again");
      await vi.waitFor(() =>
        expect(clientState.callAction).toHaveBeenLastCalledWith(
          "route-app-intent",
          expect.objectContaining({ selection: "Edited message" }),
          expect.anything(),
        ),
      );

      await openFrame("notes", () => "Visible note");
      mailRead.mockClear();
      await send("Summarize the current selection");
      await vi.waitFor(() =>
        expect(clientState.callAction).toHaveBeenLastCalledWith(
          "route-app-intent",
          expect.objectContaining({
            openApp: "notes",
            openPath: "/notes/current",
            selection: "Visible note",
          }),
          expect.anything(),
        ),
      );
      expect(mailRead).not.toHaveBeenCalled();
    });

    it("does not route a send from another chat", async () => {
      await renderChat("/chat/route-own-chat");
      await act(async () => {
        reportAgentChatComposerSubmit({
          text: "show my inbox",
          threadId: "another-thread",
        });
      });
      expect(clientState.callAction).not.toHaveBeenCalled();
    });

    it("drops an answer once a queued message was sent after it", async () => {
      await renderChat("/chat/route-queued");
      const route = routeTo({
        status: "ok",
        app: "mail",
        confidence: 1,
        explicit: true,
      });
      await send("show my inbox");
      await act(async () => {
        reportAgentChatComposerSubmit({ text: "and my notes", queued: true });
      });
      await route.answer();
      expect(clientState.callAction).toHaveBeenCalledTimes(1);
      expect(appTabs("route-queued")).toEqual([]);
    });

    it("drops an answer for a send that was withdrawn", async () => {
      await renderChat("/chat/route-withdrawn");
      const route = routeTo({
        status: "ok",
        app: "mail",
        confidence: 1,
        explicit: true,
      });
      let id: string | null = null;
      await act(async () => {
        id = reportAgentChatComposerSubmit({ text: "show my inbox" });
      });
      await act(async () => {
        withdrawAgentChatComposerSubmit(id);
      });
      await route.answer();
      expect(appTabs("route-withdrawn")).toEqual([]);
    });

    it("drops an answer once the person left the chat", async () => {
      await renderChat(
        "/chat/route-left",
        <ChatRouteSwitcher target="/agents" />,
      );
      const route = routeTo({
        status: "ok",
        app: "mail",
        confidence: 1,
        explicit: true,
      });
      await send("show my inbox");
      await act(async () => {
        [...container.querySelectorAll("button")]
          .find((button) => button.textContent === "Switch chat")
          ?.click();
      });
      await route.answer();
      expect(appTabs("route-left")).toEqual([]);
      expect(appTabs("new")).toEqual([]);
    });

    it("drops a new chat's waiting pane when a newer message is sent", async () => {
      await renderChat(
        "/chat",
        <ChatRouteSwitcher target="/chat/route-superseded" />,
      );
      const first = routeTo({
        status: "ok",
        app: "mail",
        confidence: 1,
        explicit: true,
      });
      const second = routeTo({ status: "ok", app: "none", confidence: 1 });
      await send("show my inbox");
      await first.answer();
      await send("never mind");
      await second.answer();
      await act(async () => {
        [...container.querySelectorAll("button")]
          .find((button) => button.textContent === "Switch chat")
          ?.click();
      });
      expect(appTabs("route-superseded")).toEqual([]);
    });

    it("moves the same pane when the agent opens that app deeper", async () => {
      await renderChat("/chat/route-same-app");
      const route = routeTo({
        status: "ok",
        app: "mail",
        confidence: 1,
        explicit: true,
      });
      await send("show my inbox");
      await route.answer();
      const [openedId] = appTabs("route-same-app").map((tab) => tab.id);
      await act(async () => {
        emitChatFirstOpenApp({ app: "mail", path: "/inbox/thread-1" });
      });
      const tabs = appTabs("route-same-app");
      expect(tabs).toHaveLength(1);
      expect(tabs[0]).toMatchObject({
        id: openedId,
        appId: "mail",
        path: "/inbox/thread-1",
      });
    });

    it("replaces the pane when the agent opens a different app", async () => {
      await renderChat("/chat/route-other-app");
      const route = routeTo({
        status: "ok",
        app: "mail",
        confidence: 1,
        explicit: true,
      });
      await send("show my inbox");
      await route.answer();
      await act(async () => {
        emitChatFirstOpenApp({ app: "notes" });
      });
      expect(appTabs("route-other-app").map((tab) => tab.appId)).toEqual([
        "notes",
      ]);
    });

    it("keeps an app the agent opened after the routed turn", async () => {
      await renderChat("/chat/route-later-turn");
      const route = routeTo({
        status: "ok",
        app: "mail",
        confidence: 1,
        explicit: true,
      });
      await send("show my inbox");
      await route.answer();
      await send("thanks");
      await act(async () => {
        emitChatFirstOpenApp({ app: "notes" });
      });
      expect(appTabs("route-later-turn").map((tab) => tab.appId)).toEqual([
        "mail",
        "notes",
      ]);
    });

    it("opens a new chat's pane once the chat has an id, on the prefetched session", async () => {
      await renderChat(
        "/chat",
        <ChatRouteSwitcher target="/chat/route-first-turn" />,
      );
      clientState.createEmbedSessionMutateAsync.mockClear();
      const route = routeTo({
        status: "ok",
        app: "mail",
        confidence: 1,
        explicit: true,
      });
      await send("show my inbox");
      await route.answer();
      expect(container.querySelector("[data-chat-first-app-pane]")).toBeNull();
      expect(clientState.createEmbedSessionMutateAsync).toHaveBeenCalledTimes(
        1,
      );

      await act(async () => {
        [...container.querySelectorAll("button")]
          .find((button) => button.textContent === "Switch chat")
          ?.click();
      });

      expect(appTabs("route-first-turn").map((tab) => tab.appId)).toEqual([
        "mail",
      ]);
      expect(clientState.createEmbedSessionMutateAsync).toHaveBeenCalledTimes(
        1,
      );
    });

    it("opens a new chat's pane at route time when the send names its thread, and keeps it when the URL catches up", async () => {
      await renderChat(
        "/chat",
        <ChatRouteSwitcher target="/chat/route-named-thread" />,
      );
      const route = routeTo({
        status: "ok",
        app: "mail",
        confidence: 1,
        explicit: true,
      });
      await act(async () => {
        reportAgentChatComposerSubmit({
          text: "show my inbox",
          threadId: "route-named-thread",
          queued: false,
        });
      });
      await route.answer();

      expect(
        container.querySelector("[data-chat-first-app-pane]"),
      ).not.toBeNull();
      const opened = appTabs("route-named-thread");
      expect(opened.map((tab) => tab.appId)).toEqual(["mail"]);

      await act(async () => {
        [...container.querySelectorAll("button")]
          .find((button) => button.textContent === "Switch chat")
          ?.click();
      });

      expect(appTabs("route-named-thread")).toEqual(opened);
      expect(
        container.querySelector("[data-chat-first-app-pane]"),
      ).not.toBeNull();
    });

    it("forgets a sent new chat's thread when another new chat starts", async () => {
      await renderChat("/chat", <ChatRouteSwitcher target="/chat" />);
      const route = routeTo({
        status: "ok",
        app: "mail",
        confidence: 1,
        explicit: true,
      });
      await act(async () => {
        reportAgentChatComposerSubmit({
          text: "show my inbox",
          threadId: "route-abandoned-thread",
          queued: false,
        });
      });
      await route.answer();
      expect(
        container.querySelector("[data-chat-first-app-pane]"),
      ).not.toBeNull();

      await act(async () => {
        [...container.querySelectorAll("button")]
          .find((button) => button.textContent === "Switch chat")
          ?.click();
      });

      expect(container.querySelector("[data-chat-first-app-pane]")).toBeNull();
    });

    it("clears a provisional new-chat thread when its send is withdrawn, without clearing a newer send", async () => {
      await renderChat("/chat");
      const firstRoute = routeTo({
        status: "ok",
        app: "mail",
        confidence: 1,
        explicit: true,
      });
      let firstSubmitId: string | null = null;
      await act(async () => {
        firstSubmitId = reportAgentChatComposerSubmit({
          text: "show my inbox",
          threadId: "route-withdrawn-thread",
          queued: false,
        });
      });
      await act(async () => {
        withdrawAgentChatComposerSubmit(firstSubmitId);
      });
      await firstRoute.answer();

      expect(appTabs("route-withdrawn-thread")).toEqual([]);
      expect(container.querySelector("[data-chat-first-app-pane]")).toBeNull();

      const secondRoute = routeTo({
        status: "ok",
        app: "mail",
        confidence: 1,
        explicit: true,
      });
      await act(async () => {
        reportAgentChatComposerSubmit({
          text: "show my inbox again",
          threadId: "route-kept-thread",
          queued: false,
        });
      });
      await act(async () => {
        withdrawAgentChatComposerSubmit(firstSubmitId);
      });
      await secondRoute.answer();

      expect(appTabs("route-kept-thread").map((tab) => tab.appId)).toEqual([
        "mail",
      ]);
      expect(
        container.querySelector("[data-chat-first-app-pane]"),
      ).not.toBeNull();
    });

    it("clears the provisional scope once the URL catches up, so navigating Back returns to a blank new chat", async () => {
      await renderChat(
        "/chat",
        <ChatRouteSwitcher target="/chat/route-back-thread" />,
      );
      const route = routeTo({
        status: "ok",
        app: "mail",
        confidence: 1,
        explicit: true,
      });
      await act(async () => {
        reportAgentChatComposerSubmit({
          text: "show my inbox",
          threadId: "route-back-thread",
          queued: false,
        });
      });
      await route.answer();
      expect(
        container.querySelector("[data-chat-first-app-pane]"),
      ).not.toBeNull();

      await act(async () => {
        [...container.querySelectorAll("button")]
          .find((button) => button.textContent === "Switch chat")
          ?.click();
      });
      expect(
        container.querySelector("[data-chat-first-app-pane]"),
      ).not.toBeNull();

      await act(async () => {
        [...container.querySelectorAll("button")]
          .find((button) => button.textContent === "Go back")
          ?.click();
      });
      expect(container.querySelector("[data-chat-first-app-pane]")).toBeNull();
    });

    it("does not flash a previous session's saved pane before routing a new chat", async () => {
      clientState.connectedApps = [
        {
          id: "calendar",
          name: "Calendar",
          url: "https://calendar.agent-native.com",
          source: "builtin",
        },
      ];
      clientState.appState[CHAT_FIRST_PANE_STATE_KEY] = {
        appId: "mail",
        path: "/inbox",
      };
      await renderChat(
        "/chat",
        <ChatRouteSwitcher target="/chat/new-chat-no-flash" />,
      );
      const route = routeTo({
        status: "ok",
        app: "calendar",
        confidence: 1,
        explicit: true,
      });
      await send("hows my week look");
      await route.answer();
      expect(container.querySelector("[data-chat-first-app-pane]")).toBeNull();
      await act(async () => {
        [...container.querySelectorAll("button")]
          .find((button) => button.textContent === "Switch chat")
          ?.click();
      });

      expect(appTabs("new-chat-no-flash").map((tab) => tab.appId)).toEqual([
        "calendar",
      ]);
    });

    it("routes a new chat's first send and a settled follow-up when queued is false, and skips a queued send", async () => {
      await renderChat(
        "/chat",
        <ChatRouteSwitcher target="/chat/route-lifecycle" />,
      );
      const first = routeTo({
        status: "ok",
        app: "mail",
        confidence: 1,
        explicit: true,
      });
      await act(async () => {
        reportAgentChatComposerSubmit({
          text: "show my inbox",
          tabId: "route-lifecycle",
          threadId: "route-lifecycle",
          queued: false,
        });
      });
      expect(clientState.callAction).toHaveBeenCalledTimes(1);
      expect(clientState.callAction).toHaveBeenLastCalledWith(
        "route-app-intent",
        { text: "show my inbox" },
        expect.objectContaining({ timeoutMs: expect.any(Number) }),
      );
      await first.answer();
      await act(async () => {
        [...container.querySelectorAll("button")]
          .find((button) => button.textContent === "Switch chat")
          ?.click();
      });
      expect(appTabs("route-lifecycle").map((tab) => tab.appId)).toEqual([
        "mail",
      ]);

      await act(async () => {
        reportAgentChatComposerSubmit({
          text: "queued behind active run",
          tabId: "route-lifecycle",
          threadId: "route-lifecycle",
          queued: true,
        });
      });
      expect(clientState.callAction).toHaveBeenCalledTimes(1);

      const second = routeTo({
        status: "ok",
        app: "notes",
        confidence: 1,
        explicit: true,
      });
      await act(async () => {
        reportAgentChatComposerSubmit({
          text: "open my Q4 planning doc",
          tabId: "route-lifecycle",
          threadId: "route-lifecycle",
          queued: false,
        });
      });
      expect(clientState.callAction).toHaveBeenCalledTimes(2);
      expect(clientState.callAction).toHaveBeenLastCalledWith(
        "route-app-intent",
        { text: "open my Q4 planning doc", openApp: "mail" },
        expect.objectContaining({ timeoutMs: expect.any(Number) }),
      );
      await second.answer();
      expect(appTabs("route-lifecycle").map((tab) => tab.appId)).toEqual([
        "mail",
        "notes",
      ]);
    });
  });

  it("opens a connected built-in when mounted workspace-app discovery fails", async () => {
    clientState.workspaceAppsError = new Error("Workspace apps unavailable");
    clientState.connectedApps = [
      {
        id: "clips",
        name: "Clips",
        url: "https://clips.agent-native.com",
        source: "builtin",
      },
    ];

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat/builtin-mounted-error"]}>
          <Layout extensions={{ chatFirst: true }}>
            <div />
          </Layout>
        </MemoryRouter>,
      );
    });

    await act(async () => {
      emitChatFirstOpenApp({ app: "clips" });
    });

    expect(
      container.querySelector("[data-chat-first-app-pane]"),
    ).not.toBeNull();
  });

  it("keeps hosted apps the organization hides out of the rail but openable", async () => {
    clientState.workspaceApps = [
      { id: "notes", name: "Notes", path: "/notes", status: "ready" },
    ];
    clientState.connectedApps = [
      {
        id: "clips",
        name: "Clips",
        url: "https://clips.agent-native.com",
        source: "builtin",
        hiddenFromLaunchers: true,
      },
    ];

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat/hosted-hidden"]}>
          <Layout extensions={{ chatFirst: true }}>
            <div />
          </Layout>
        </MemoryRouter>,
      );
    });

    expect(
      container.querySelector('[data-chat-first-app][data-app-id="notes"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-chat-first-app][data-app-id="clips"]'),
    ).toBeNull();

    await act(async () => {
      emitChatFirstOpenApp({ app: "clips" });
    });

    expect(
      container.querySelector("[data-chat-first-app-pane]"),
    ).not.toBeNull();
  });

  it("retries an app open after connected built-in discovery recovers", async () => {
    clientState.workspaceApps = [
      {
        id: "mail",
        name: "Mail",
        path: "/mail",
        url: "/mail",
        status: "ready",
      },
    ];
    clientState.connectedAppsError = new Error("Connected apps unavailable");

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat/discovery-retry"]}>
          <Layout extensions={{ chatFirst: true }}>
            <div />
          </Layout>
        </MemoryRouter>,
      );
    });
    await act(async () => {
      emitChatFirstOpenApp({ app: "clips" });
    });

    expect(container.querySelector("[data-chat-first-app-pane]")).toBeNull();

    clientState.connectedAppsError = null;
    clientState.connectedApps = [
      {
        id: "clips",
        name: "Clips",
        url: "https://clips.agent-native.com",
        source: "builtin",
      },
    ];
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat/review-fixture"]}>
          <Layout extensions={{ chatFirst: true }}>
            <div />
          </Layout>
        </MemoryRouter>,
      );
    });

    expect(
      container.querySelector("[data-chat-first-app-pane]"),
    ).not.toBeNull();
  });

  it("keeps saved pins when the rail pins an app before workspace state loads", async () => {
    clientState.workspaceApps = ["alpha", "beta"].map((id) => ({
      id,
      name: id,
      path: `/${id}`,
      url: `https://${id}.example.com`,
      status: "ready",
    }));
    let resolveLayout: (value: unknown) => void = () => {};
    clientState.appStatePromises["chat-first-app-layout"] = new Promise(
      (resolve) => {
        resolveLayout = resolve;
      },
    );

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat"]}>
          <Layout extensions={{ chatFirst: true }}>
            <div />
          </Layout>
        </MemoryRouter>,
      );
    });
    const pinAlpha = container.querySelector<HTMLButtonElement>(
      '[data-chat-first-app][data-app-id="alpha"] button[aria-pressed]',
    );
    expect(pinAlpha).not.toBeNull();
    await act(async () => pinAlpha!.click());
    await act(async () => {
      resolveLayout({ pinnedIds: ["beta"], orderedIds: [] });
    });

    expect(clientState.appState["chat-first-app-layout"]).toEqual({
      pinnedIds: ["alpha", "beta"],
      orderedIds: [],
    });
  });

  it("loads saved pins for the rail on non-chat routes", async () => {
    clientState.workspaceApps = ["alpha", "beta"].map((id) => ({
      id,
      name: id,
      path: `/${id}`,
      url: `https://${id}.example.com`,
      status: "ready",
    }));
    clientState.appState["chat-first-app-layout"] = {
      pinnedIds: ["beta"],
      orderedIds: [],
    };

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/admin/automations"]}>
          <Layout extensions={{ chatFirst: true }}>
            <div />
          </Layout>
        </MemoryRouter>,
      );
    });

    expect(
      container
        .querySelector(
          '[data-chat-first-app][data-app-id="beta"] button[aria-pressed]',
        )
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("keeps hidden Dispatch registered for agent app targets", async () => {
    clientState.workspaceApps = [
      {
        id: "dispatch",
        name: "Dispatch",
        path: "/dispatch",
        url: "https://dispatch.agent-native.com",
        isDispatch: true,
        status: "ready",
      },
    ];

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat/review-fixture"]}>
          <Layout extensions={{ chatFirst: true }}>
            <div />
          </Layout>
        </MemoryRouter>,
      );
    });
    await act(async () => {
      emitChatFirstOpenApp({ app: "dispatch" });
    });

    expect(container.querySelector("[data-app-notice]")).toBeNull();
  });

  it("does not restore a deferred pane after switching chats", async () => {
    clientState.connectedAppsLoading = true;
    clientState.appState[CHAT_FIRST_PANE_STATE_KEY] = {
      appId: "clips",
      path: "/inbox",
    };
    const onPathChange = vi.fn();
    const renderLayout = () => (
      <MemoryRouter initialEntries={["/chat/pane-restore"]}>
        <Layout extensions={{ chatFirst: true }}>
          <ChatRouteSwitcher target="/chat/next-chat" />
        </Layout>
        <LocationProbe onChange={onPathChange} />
      </MemoryRouter>
    );

    await act(async () => {
      root.render(renderLayout());
    });
    expect(container.querySelector("[data-chat-first-app-pane]")).toBeNull();

    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Switch chat")
        ?.click();
    });
    expect(onPathChange).toHaveBeenLastCalledWith("/chat/next-chat");

    clientState.connectedAppsLoading = false;
    clientState.connectedApps = [
      {
        id: "clips",
        name: "Clips",
        url: "https://clips.agent-native.com",
        source: "builtin",
      },
    ];
    await act(async () => {
      root.render(renderLayout());
    });

    expect(container.querySelector("[data-chat-first-app-pane]")).toBeNull();
  });

  it("ignores pane hydration that finishes after switching chats", async () => {
    let resolvePaneState!: (value: unknown) => void;
    clientState.appStatePromises[CHAT_FIRST_PANE_STATE_KEY] = new Promise(
      (resolve) => {
        resolvePaneState = resolve;
      },
    );
    clientState.connectedApps = [
      {
        id: "clips",
        name: "Clips",
        url: "https://clips.agent-native.com",
        source: "builtin",
      },
    ];
    const onPathChange = vi.fn();
    const renderLayout = () => (
      <MemoryRouter initialEntries={["/chat/pane-read-hydration"]}>
        <Layout extensions={{ chatFirst: true }}>
          <ChatRouteSwitcher target="/chat/new-scope" />
        </Layout>
        <LocationProbe onChange={onPathChange} />
      </MemoryRouter>
    );

    await act(async () => {
      root.render(renderLayout());
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Switch chat")
        ?.click();
    });
    expect(onPathChange).toHaveBeenLastCalledWith("/chat/new-scope");

    await act(async () => {
      resolvePaneState({ appId: "clips", path: "/inbox" });
    });

    expect(container.querySelector("[data-chat-first-app-pane]")).toBeNull();
  });

  it("opens connected built-ins from the chat-first app rail", async () => {
    clientState.connectedApps = [
      {
        id: "clips",
        name: "Clips",
        url: "https://clips.agent-native.com",
        source: "builtin",
      },
    ];

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat/rail-built-in"]}>
          <Layout extensions={{ chatFirst: true }}>
            <div />
          </Layout>
        </MemoryRouter>,
      );
    });
    await act(async () => {
      const clipsApp = container.querySelector<HTMLElement>(
        '[data-chat-first-app][data-app-id="clips"]',
      );
      const openButton =
        clipsApp?.querySelector<HTMLButtonElement>("button") ??
        (clipsApp as HTMLButtonElement | null);
      openButton?.click();
    });

    expect(workspaceAppNavigation.navigateToWorkspaceApp).toHaveBeenCalledWith(
      "https://clips.agent-native.com/home",
    );
  });

  it("restores a mounted pane without waiting for optional built-in discovery", async () => {
    clientState.workspaceApps = [
      {
        id: "mail",
        name: "Mail",
        path: "/mail",
        url: "/mail",
        status: "ready",
      },
    ];
    clientState.connectedAppsLoading = true;
    clientState.appState[CHAT_FIRST_PANE_STATE_KEY] = {
      appId: "mail",
      path: "/inbox",
    };

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat/review-fixture"]}>
          <Layout extensions={{ chatFirst: true }}>
            <div />
          </Layout>
        </MemoryRouter>,
      );
    });

    expect(
      container.querySelector("[data-chat-first-app-pane]"),
    ).not.toBeNull();
  });

  it("restores a saved pane when the first mount is discarded", async () => {
    clientState.connectedApps = [
      {
        id: "clips",
        name: "Clips",
        url: "https://clips.agent-native.com",
        source: "builtin",
      },
    ];
    clientState.appState[CHAT_FIRST_PANE_STATE_KEY] = {
      appId: "clips",
      path: "/inbox",
    };

    await act(async () => {
      root.render(
        <React.StrictMode>
          <MemoryRouter initialEntries={["/chat/strict-restore"]}>
            <Layout extensions={{ chatFirst: true }}>
              <div />
            </Layout>
          </MemoryRouter>
        </React.StrictMode>,
      );
    });

    expect(
      container.querySelector("[data-chat-first-app-pane]"),
    ).not.toBeNull();
    expect(container.querySelector("[data-app-notice]")).toBeNull();
  });

  it.each([[null], [{ appId: 7 }]])(
    "only reports a restore failure for unreadable pane state %j",
    async (saved) => {
      clientState.appState[CHAT_FIRST_PANE_STATE_KEY] = saved;

      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={["/chat/pane-state-outcome"]}>
            <Layout extensions={{ chatFirst: true }}>
              <div />
            </Layout>
          </MemoryRouter>,
        );
      });

      expect(container.querySelector("[data-app-notice]") !== null).toBe(
        saved !== null,
      );
    },
  );

  it("puts Overview before Chat in the primary navigation", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/overview"]}>
          <TooltipProvider>
            <NavContent />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    const primaryLabels = [...container.querySelectorAll("nav a")].map((link) =>
      link.textContent?.trim(),
    );
    expect(primaryLabels.indexOf("Overview")).toBeLessThan(
      primaryLabels.indexOf("Chat"),
    );
    expect(primaryLabels).toContain("Agents");
  });

  it("keeps collapsed navigation compact and preserves section spacing", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/overview"]}>
          <TooltipProvider>
            <NavContent collapsed />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    const lists = [...container.querySelectorAll("nav > ul")];
    expect(lists).toHaveLength(2);
    expect(lists[0].className).toContain("gap-1");
    expect(lists[1].className).toContain("gap-1");
    expect(lists[1].querySelector('a[href="/admin"]')).not.toBeNull();
    expect(lists[1].querySelector('a[href="/settings"]')).not.toBeNull();
    expect(lists[0].querySelector("a")?.className).toContain("size-9");
  });

  it.each([
    { mode: "standard", chatFirstMode: false, collapsed: false },
    { mode: "standard", chatFirstMode: false, collapsed: true },
    { mode: "chat-first", chatFirstMode: true, collapsed: false },
    { mode: "chat-first", chatFirstMode: true, collapsed: true },
  ])(
    "keeps footer controls flush with the bottom in the $mode desktop footer when collapsed is $collapsed",
    async ({ mode, chatFirstMode, collapsed }) => {
      await act(async () => {
        root.render(
          <MemoryRouter
            initialEntries={[chatFirstMode ? "/chat" : "/overview"]}
          >
            <TooltipProvider>
              <NavContent
                chatFirstMode={chatFirstMode}
                collapsed={collapsed}
                collapsible
              />
            </TooltipProvider>
          </MemoryRouter>,
        );
      });

      const footer = container.querySelector(
        `[data-dispatch-sidebar-footer="${mode}"]`,
      );
      const adminLink = footer?.querySelector('a[href="/admin"]');
      const settingsLink = footer?.querySelector('a[href="/settings"]');
      const organization = [...(footer?.querySelectorAll("div") ?? [])].find(
        (element) => element.textContent?.trim() === "Organization",
      );
      const feedback = [...(footer?.querySelectorAll("div") ?? [])].find(
        (element) => element.textContent?.trim() === "Feedback",
      );
      const collapse = footer?.querySelector(
        'button[aria-label="Expand sidebar"], button[aria-label="Collapse sidebar"]',
      );

      expect(footer?.className).toContain("mt-auto");
      expect(footer?.className).toContain("shrink-0");
      expect(footer?.className).not.toContain("pb-10");
      if (mode === "standard") {
        expect(footer?.closest(".overflow-y-auto")).toBeNull();
      }
      expect(adminLink).not.toBeNull();
      expect(settingsLink).not.toBeNull();
      expect(organization).toBeDefined();
      expect(feedback).toBeDefined();
      expect(collapse).not.toBeNull();
      expect(adminLink!.compareDocumentPosition(settingsLink!)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(settingsLink!.compareDocumentPosition(feedback!)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(feedback!.compareDocumentPosition(organization!)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(collapse).not.toBeNull();
    },
  );

  it("keeps chat-first primary actions in the collapsed sidebar", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat"]}>
          <TooltipProvider>
            <NavContent
              chatFirstMode
              collapsed
              chatFirstApps={[{ id: "mail", name: "Mail" }]}
            />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    for (const label of ["New chat", "Integrations", "Search"]) {
      expect(
        [...container.querySelectorAll("button")].find(
          (button) => button.textContent?.trim() === label,
        ),
      ).toBeDefined();
    }
    expect(
      container.querySelector("[data-chat-first-apps-rail]"),
    ).not.toBeNull();
  });

  it("keeps management routes out of the primary navigation", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/overview"]}>
          <TooltipProvider>
            <NavContent />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('a[href="/admin"]')).not.toBeNull();
    expect(container.querySelector('a[href="/operations"]')).toBeNull();
    expect(container.querySelector('a[href="/metrics"]')).toBeNull();
    expect(container.textContent).not.toContain("Automation & delivery");
  });

  it("renders the Admin control plane with grouped nested routes", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/admin/metrics"]}>
          <TooltipProvider>
            <AdminShell>
              <div>Admin content</div>
            </AdminShell>
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    const shell = container.querySelector("[data-dispatch-admin-shell]");
    expect(shell).not.toBeNull();
    expect(shell?.textContent).toContain("Operations");
    expect(shell?.textContent).toContain("Automation & delivery");
    expect(shell?.querySelector('a[href="/admin/metrics"]')).not.toBeNull();
    expect(
      shell?.querySelector('a[href="/admin/metrics"][aria-current="page"]'),
    ).not.toBeNull();
    expect(shell?.querySelector('a[href="/metrics"]')).toBeNull();
    expect(shell?.querySelector('a[href="/admin/apps"]')).toBeNull();
  });

  it("keeps workspace app discovery in the Apps destination", async () => {
    clientState.workspaceApps = [
      { id: "calendar", name: "Calendar", path: "/calendar", status: "ready" },
      { id: "pending", name: "Pending", path: "/pending", status: "pending" },
    ];

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/overview"]}>
          <TooltipProvider>
            <NavContent />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    expect(container.querySelector("[data-dispatch-apps-rail]")).toBeNull();
    expect(container.querySelector('a[href="/apps"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Calendar");
    expect(container.textContent).not.toContain("Pending");

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/apps/calendar"]}>
          <TooltipProvider>
            <NavContent />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('a[href="/apps"]')?.className).toContain(
      "bg-sidebar-accent",
    );
  });

  it("keeps Dispatch branding and anchors Settings above the organization picker", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/overview"]}>
          <TooltipProvider>
            <NavContent />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    const sidebarLabel = [...container.querySelectorAll("span")].find(
      (element) => element.textContent?.trim() === "Dispatch",
    );
    expect(sidebarLabel?.textContent?.trim()).toBe("Dispatch");
    expect(container.textContent).not.toContain("Agent-Native Dispatch");
    expect(
      sidebarLabel?.closest('a[href="/overview"], a[href*="/overview"]'),
    ).not.toBeNull();

    const settingsLink = container.querySelector('a[href="/settings"]');
    const adminLink = container.querySelector('a[href="/admin"]');
    const organization = [...container.querySelectorAll("div")].find(
      (element) => element.textContent?.trim() === "Organization",
    );
    const feedback = [...container.querySelectorAll("div")].find(
      (element) => element.textContent?.trim() === "Feedback",
    );

    expect(settingsLink).not.toBeNull();
    expect(adminLink).not.toBeNull();
    expect(organization).toBeDefined();
    expect(feedback).toBeDefined();
    expect(settingsLink!.compareDocumentPosition(feedback!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(adminLink!.compareDocumentPosition(settingsLink!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(feedback!.compareDocumentPosition(organization!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("accepts a custom workspace name and icon", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/overview"]}>
          <TooltipProvider>
            <NavContent
              brandName="Acme Workspace"
              brandIcon={<svg data-acme-mark aria-hidden="true" />}
            />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    const brandLink = container.querySelector('a[href="/overview"]');
    expect(brandLink?.getAttribute("aria-label")).toBe("Acme Workspace");
    expect(brandLink?.textContent?.trim()).toBe("Acme Workspace");
    expect(brandLink?.querySelector("[data-acme-mark]")).not.toBeNull();
    expect(brandLink?.querySelector("[data-agent-native-icon]")).toBeNull();
    expect(container.textContent).not.toContain("Dispatch");

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/overview"]}>
          <TooltipProvider>
            <NavContent
              collapsed
              brandName="Acme Workspace"
              brandIcon={<svg data-acme-mark aria-hidden="true" />}
            />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    const collapsedBrandLink = container.querySelector('a[href="/overview"]');
    expect(collapsedBrandLink?.getAttribute("aria-label")).toBe(
      "Acme Workspace",
    );
    expect(
      collapsedBrandLink?.querySelector("[data-acme-mark]"),
    ).not.toBeNull();
    expect(collapsedBrandLink?.textContent?.trim()).toBe("");
  });

  it("keeps Admin above Settings in the chat-first left sidebar", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat"]}>
          <TooltipProvider>
            <NavContent chatFirstMode />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    const adminLink = container.querySelector('a[href="/admin"]');
    const settingsLink = container.querySelector('a[href="/settings"]');
    const organization = [...container.querySelectorAll("div")].find(
      (element) => element.textContent?.trim() === "Organization",
    );

    expect(adminLink).not.toBeNull();
    expect(settingsLink).not.toBeNull();
    expect(organization).toBeDefined();
    expect(adminLink!.compareDocumentPosition(settingsLink!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(settingsLink!.compareDocumentPosition(organization!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("keeps an All apps destination below the chat-first app list", async () => {
    const paths: string[] = [];
    const apps = Array.from({ length: 6 }, (_, index) => ({
      id: `app-${index}`,
      name: `App ${index}`,
    }));

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat"]}>
          <TooltipProvider>
            <NavContent chatFirstMode chatFirstApps={apps} />
            <LocationProbe onChange={(path) => paths.push(path)} />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    expect(container.querySelectorAll("[data-chat-first-app]")).toHaveLength(3);
    expect(
      container.querySelector('[data-chat-first-app-section="apps"]')
        ?.textContent,
    ).toContain("Apps");
    expect(
      container.querySelector('[data-chat-first-app][draggable="true"]'),
    ).toBeNull();
    expect(
      container.querySelector(
        "[data-chat-first-apps-rail] button[aria-expanded]",
      ),
    ).toBeNull();

    const allApps = container.querySelector<HTMLButtonElement>(
      "[data-chat-first-all-apps]",
    );
    expect(allApps?.textContent?.trim()).toBe("All apps");
    await act(async () => {
      allApps?.click();
    });
    expect(paths.at(-1)).toBe("/apps");
  });

  describe.each([false, true])(
    "the chat-first rail's apps (collapsed %s)",
    (collapsed) => {
      const workspace = ["zeta", "eta", "beta", "delta", "alpha"].map((id) => ({
        id,
        name: id[0]!.toUpperCase() + id.slice(1),
      }));
      const hosted = ["mail", "clips", "slides", "design"].map((id) => ({
        id,
        name: id,
        source: "builtin" as const,
      }));
      async function renderRail(
        apps: Array<{ id: string; name: string; source?: "builtin" }>,
        pinnedIds: string[],
        activeAppId?: string,
      ) {
        await act(async () => {
          root.render(
            <MemoryRouter initialEntries={["/chat"]}>
              <TooltipProvider>
                <NavContent
                  chatFirstMode
                  collapsed={collapsed}
                  chatFirstApps={apps}
                  chatFirstAppLayout={{ pinnedIds, orderedIds: [] }}
                  {...(activeAppId
                    ? { chatFirstActiveAppId: activeAppId }
                    : {})}
                />
              </TooltipProvider>
            </MemoryRouter>,
          );
        });
        const sections = [
          ...container.querySelectorAll<HTMLElement>(
            "[data-chat-first-app-section]",
          ),
        ].map((section) => section.dataset.chatFirstAppSection);
        return {
          sections,
          ids: [
            ...container.querySelectorAll<HTMLElement>("[data-chat-first-app]"),
          ].map((row) => row.dataset.appId),
        };
      }

      it("shows only pins, in pin order, once something is pinned", async () => {
        const rail = await renderRail(
          [...workspace, ...hosted],
          ["clips", "beta"],
        );
        expect(rail.ids).toEqual(["clips", "beta"]);
        if (!collapsed) {
          expect(rail.sections).toEqual(["pinned"]);
          expect(
            container
              .querySelector("[data-chat-first-app-section]")
              ?.getAttribute("aria-label"),
          ).toBe("dispatch.pages.pinnedApps");
        }
      });

      it("suggests the first three workspace apps A to Z with no pins", async () => {
        const rail = await renderRail([...workspace, ...hosted], []);
        expect(rail.ids).toEqual(["alpha", "beta", "delta"]);
        if (!collapsed) expect(rail.sections).toEqual(["apps"]);
      });

      it("suggests hosted apps when the workspace has none", async () => {
        const rail = await renderRail(hosted, []);
        expect(rail.ids).toEqual(["clips", "design", "mail"]);
      });

      it("adds the open app when it is not shown", async () => {
        const rail = await renderRail(
          [...workspace, ...hosted],
          ["clips"],
          "zeta",
        );
        expect(rail.ids).toEqual(["clips", "zeta"]);
      });
    },
  );

  it.each([
    ["loading", false],
    ["error", false],
    ["ready", true],
  ] as const)(
    "says there are no apps only once the list arrived (%s)",
    async (status, saysEmpty) => {
      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={["/chat"]}>
            <TooltipProvider>
              <NavContent
                chatFirstMode
                chatFirstApps={[]}
                chatFirstAppsStatus={status}
              />
            </TooltipProvider>
          </MemoryRouter>,
        );
      });

      const appsText =
        container.querySelector('[data-chat-first-app-section="apps"]')
          ?.textContent ?? "";
      if (saysEmpty) expect(appsText).toContain("No apps yet");
      else expect(appsText).not.toContain("No apps yet");
    },
  );

  it("does not re-render the apps rail when the sidebar re-renders with the same apps", async () => {
    const apps = [
      { id: "alpha", name: "Alpha" },
      { id: "mail", name: "Mail", source: "builtin" as const },
    ];
    const layout = { pinnedIds: [], orderedIds: [] };
    const renderNav = () =>
      root.render(
        <MemoryRouter initialEntries={["/chat"]}>
          <TooltipProvider>
            <NavContent
              chatFirstMode
              chatFirstApps={apps}
              chatFirstAppLayout={layout}
            />
          </TooltipProvider>
        </MemoryRouter>,
      );

    await act(async () => renderNav());
    const rendersAfterMount = clientState.railRenders;
    expect(rendersAfterMount).toBeGreaterThan(0);
    await act(async () => renderNav());

    expect(clientState.railRenders).toBe(rendersAfterMount);
  });

  it("omits the Chats section when chat-first has no chats", async () => {
    clientState.threads = [];
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat"]}>
          <TooltipProvider>
            <NavContent
              chatFirstMode
              collapsible
              chatFirstApps={[{ id: "mail", name: "Mail" }]}
            />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    expect(container.textContent).not.toContain("Chats");
    expect(container.querySelector("[data-chat-first-app]")).not.toBeNull();
    expect(
      container.querySelector("[data-chat-first-app] span[style]"),
    ).not.toBeNull();
    expect(container.textContent).toContain("Feedback");
    expect(
      container.querySelector(
        'button[aria-label="Expand sidebar"], button[aria-label="Collapse sidebar"]',
      ),
    ).not.toBeNull();
  });

  it("opens a workspace app in the main app route from the left rail", async () => {
    const paths: string[] = [];
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat"]}>
          <TooltipProvider>
            <NavContent
              chatFirstMode
              chatFirstApps={[{ id: "mail", name: "Mail" }]}
              onChatFirstAppOpen={(app) => paths.push(`/apps/${app.id}`)}
            />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>("[data-chat-first-app] button")
        ?.click();
    });
    expect(paths).toEqual(["/apps/mail"]);
  });

  async function renderHistory(
    chatFirstMode = false,
    path = "/chat/active-thread",
  ) {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[path]}>
          <TooltipProvider>
            <NavContent chatFirstMode={chatFirstMode} />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });
  }

  async function clickText(scope: ParentNode, text: string) {
    const button = [
      ...scope.querySelectorAll<HTMLElement>('button, [role="menuitem"]'),
    ].find((button) => button.textContent?.trim() === text);
    expect(button, text).toBeDefined();
    await act(async () => {
      button!.click();
    });
  }

  async function openThreadMenu(title: string) {
    const row = [
      ...container.querySelectorAll<HTMLElement>(".an-chat-history-row"),
    ].find((row) => row.textContent?.includes(title));
    expect(row).toBeDefined();
    await act(async () => {
      row!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    });
  }

  it.each([false, true])(
    "keeps the proven-owned active empty chat and hides inactive blanks (chat-first %s)",
    async (chatFirstMode) => {
      clientState.mineThreads = [];
      clientState.threads = clientState.threads.map((thread) => ({
        ...thread,
        messageCount: 0,
      }));
      await renderHistory(chatFirstMode, "/chat");

      expect(container.textContent).toContain("Current Dispatch work");
      expect(container.textContent).not.toContain("Earlier Dispatch work");
      expect(container.querySelectorAll(".an-chat-history-row")).toHaveLength(
        1,
      );
      expect(clientState.switchThread).not.toHaveBeenCalled();
      expect(clientState.lifecycleOptions).toHaveBeenLastCalledWith({
        autoCreate: false,
        includeExternal: false,
      });
    },
  );

  it.each(
    [false, true].flatMap((chatFirstMode) =>
      ["direct", "organization", "unproven"].map(
        (basis) => [chatFirstMode, basis] as const,
      ),
    ),
  )(
    "does not promote an active empty %s/%s lifecycle row into Mine",
    async (chatFirstMode, basis) => {
      clientState.mineThreads = [];
      const active = clientState.threads[0];
      clientState.threads = [
        {
          ...active,
          messageCount: 0,
          accessBasis: basis === "unproven" ? undefined : basis,
          ownerEmail:
            basis === "unproven" ? undefined : "colleague@example.com",
          visibility: basis === "unproven" ? undefined : "organization",
        },
      ];
      await renderHistory(chatFirstMode);

      expect(container.textContent).not.toContain("Current Dispatch work");
      expect(container.querySelector(".an-chat-history-row")).toBeNull();
      expect(clientState.switchThread).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "renders server Shared attribution, five-row disclosure and paging (chat-first %s)",
    async (chatFirstMode) => {
      clientState.sharedThreads = Array.from({ length: 6 }, (_, index) => ({
        id: `shared-${index}`,
        title: `Shared work ${index}`,
        preview: "",
        messageCount: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ownerEmail: "colleague@example.com",
        accessBasis: index === 0 ? "direct" : "organization",
        visibility: "organization",
      }));
      clientState.sharedHasMore = true;
      await renderHistory(chatFirstMode, "/chat/shared-0");
      const shared = container.querySelector(
        '[data-section-id="shared"].an-chat-history__section',
      )!;
      expect(shared).not.toBeNull();
      expect(shared.querySelectorAll(".an-chat-history-row")).toHaveLength(5);
      expect(
        shared.querySelector('[role="img"]')?.getAttribute("aria-label"),
      ).toBe("Owner: colleague@example.com");
      for (const basis of ["direct", "organization"]) {
        expect(
          shared.querySelector(
            `.an-chat-history-row__owner-mark[data-access-basis="${basis}"]`,
          ),
        ).not.toBeNull();
      }
      expect(shared.querySelector(".an-chat-history-row--pinned")).toBeNull();
      expect(
        shared.querySelector(".an-chat-history-row--active")?.textContent,
      ).toContain("Shared work 0");
      await clickText(shared, "Show all");
      expect(shared.querySelectorAll(".an-chat-history-row")).toHaveLength(6);
      clientState.sharedThreads = clientState.sharedThreads.map((row) => ({
        ...row,
      }));
      await renderHistory(chatFirstMode, "/chat/shared-0");
      expect(shared.querySelectorAll(".an-chat-history-row")).toHaveLength(6);
      expect(
        shared.querySelector(".an-chat-history-row--active")?.textContent,
      ).toContain("Shared work 0");
      expect(clientState.switchThread).not.toHaveBeenCalled();
      await clickText(shared, "Load more");
      expect(clientState.loadMore).toHaveBeenCalledOnce();
      await clickText(shared, "Show less");
      expect(shared.querySelectorAll(".an-chat-history-row")).toHaveLength(5);
      await act(async () => {
        shared
          .querySelector<HTMLButtonElement>(".an-chat-history-row__button")!
          .click();
      });
      expect(clientState.switchThread).toHaveBeenCalledWith("shared-0");
      expect(clientState.lifecycleOptions).toHaveBeenLastCalledWith({
        autoCreate: false,
        includeExternal: false,
      });
      await openThreadMenu("Shared work 0");
      expect(
        document.body.querySelector(".an-chat-history-row__menu-owner")
          ?.textContent,
      ).toContain("colleague@example.comShared with you");
      const actions = [
        ...document.body.querySelectorAll(".an-chat-history-row__menu-item"),
      ].map((item) => item.textContent);
      expect(actions).toEqual(
        expect.arrayContaining([
          "PinOnly you",
          "Copy link",
          "Hide from my list",
        ]),
      );
      for (const ownerAction of ["Rename chat", "Archive"]) {
        expect(actions).not.toContain(ownerAction);
      }
    },
  );

  it("lists chats above the apps rail", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat/active-thread"]}>
          <TooltipProvider>
            <NavContent
              chatFirstMode
              chatFirstApps={[{ id: "alpha", name: "Alpha" }]}
            />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    const chat = [...container.querySelectorAll("button, a")].find((node) =>
      node.textContent?.includes("Current Dispatch work"),
    );
    const rail = container.querySelector("[data-chat-first-apps-rail]");
    expect(chat).toBeDefined();
    expect(rail).not.toBeNull();
    expect(
      chat!.compareDocumentPosition(rail!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("puts the chat source toggle in the first chat section header", async () => {
    await renderHistory(true);

    const toggles = container.querySelectorAll(
      "[data-dispatch-chat-source-toggle]",
    );
    expect(toggles).toHaveLength(1);
    expect(toggles[0]!.parentElement!.textContent).toBe("My chats");
  });

  it.each([false, true])(
    "passes the persisted external source toggle to both ownership queries (chat-first %s)",
    async (chatFirstMode) => {
      await renderHistory(chatFirstMode);
      const toggle = container.querySelector<HTMLButtonElement>(
        "[data-dispatch-chat-source-toggle]",
      )!;
      expect(toggle.getAttribute("aria-pressed")).toBe("false");
      await act(async () => toggle.click());
      for (const ownership of ["mine", "shared"]) {
        expect(clientState.listQueries).toHaveBeenCalledWith(
          expect.objectContaining({ ownership, includeExternal: true }),
        );
      }
      expect(localStorage.getItem("dispatch.chat-history.source")).toBe("all");
    },
  );

  it.each([false, true])(
    "archives the active owned chat before opening New chat (chat-first %s)",
    async (chatFirstMode) => {
      let settle!: (value: boolean) => void;
      clientState.archiveThread.mockReturnValue(
        new Promise<boolean>((resolve) => {
          settle = resolve;
        }),
      );
      await renderHistory(chatFirstMode);
      await openThreadMenu("Current Dispatch work");
      await clickText(document.body, "Archive");
      expect(clientState.archiveThread).toHaveBeenCalledWith("active-thread");
      expect(clientState.createThread).not.toHaveBeenCalled();
      await act(async () => settle(true));
      expect(clientState.createThread).toHaveBeenCalledOnce();
      expect(clientState.switchThread).toHaveBeenCalledWith("new-thread");
    },
  );

  it.each([false, true])(
    "rolls back a failed archive, toasts once and keeps the active chat (chat-first %s)",
    async (chatFirstMode) => {
      vi.mocked(toast.error).mockClear();
      clientState.archiveThread.mockResolvedValue(false);
      await renderHistory(chatFirstMode);
      await openThreadMenu("Current Dispatch work");
      await clickText(document.body, "Archive");
      expect(container.textContent).toContain("Current Dispatch work");
      expect(clientState.createThread).not.toHaveBeenCalled();
      expect(clientState.switchThread).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledExactlyOnceWith("Failed to save");
    },
  );

  it.each([false, true])(
    "pins and renames owned rows through the adapter (chat-first %s)",
    async (chatFirstMode) => {
      await renderHistory(chatFirstMode);
      await openThreadMenu("Earlier Dispatch work");
      await clickText(document.body, "Pin");
      expect(clientState.pinThread).toHaveBeenCalledWith("older-thread", true);
      await openThreadMenu("Earlier Dispatch work");
      await clickText(document.body, "Rename chat");
      const input = container.querySelector<HTMLInputElement>(
        ".an-chat-history-row__rename-input",
      )!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, "Revised work");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await act(async () => {
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });
      expect(clientState.renameThread).toHaveBeenCalledWith(
        "older-thread",
        "Revised work",
      );
      expect(clientState.createThread).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "renders app row actions as text-only menu items (chat-first %s)",
    async (chatFirstMode) => {
      await renderHistory(chatFirstMode);
      await openThreadMenu("Earlier Dispatch work");
      const items = [
        ...document.body.querySelectorAll<HTMLElement>(
          ".an-chat-history-row__menu-item",
        ),
      ];
      const labels = items.map((item) => item.textContent?.trim());
      expect(labels).toEqual(
        expect.arrayContaining(["Rename chat", "Pin", "Archive"]),
      );
      expect(items.length).toBeGreaterThan(3);
      for (const item of items) {
        expect(item.tagName).not.toBe("BUTTON");
        expect(item.getAttribute("role")).toBe("menuitem");
        expect(item.querySelector("svg")).toBeNull();
      }
    },
  );

  it("uses the shared chat history rail and retains thread actions", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat/active-thread"]}>
          <TooltipProvider>
            <NavContent />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    expect(container.textContent).not.toContain("Chats");
    expect(container.textContent).toContain("Current Dispatch work");
    expect(container.textContent).toContain("Earlier Dispatch work");
    expect(container.textContent).toContain("New chat");
    // Rail rows show no relative time; it stays in the popover list.
    expect(container.textContent).not.toContain("5m ago");
    expect(container.querySelector('[aria-label="Slack"]')).not.toBeNull();
    const sourceToggle = container.querySelector(
      "[data-dispatch-chat-source-toggle]",
    ) as HTMLButtonElement;
    expect(sourceToggle.getAttribute("aria-pressed")).toBe("false");
    await act(async () => {
      sourceToggle.click();
    });
    expect(sourceToggle.getAttribute("aria-pressed")).toBe("true");
    expect(
      container.querySelector(".an-chat-history-row__timestamp"),
    ).toBeNull();
    const historyList = container.querySelector(
      '[data-agent-native="chat-history-list"]',
    );
    expect(historyList?.className).toContain("an-chat-history--rail");
    const sidebarLogo = container.querySelector(
      'a[href="/overview"] svg[data-agent-native-icon], [data-sidebar-header] svg[data-agent-native-icon]',
    );
    expect(sidebarLogo?.className).toContain("text-primary");
    expect(sidebarLogo?.className).toContain("h-3.5");
    expect(sidebarLogo?.className).toContain("w-6");
    expect(container.textContent).not.toContain("Workspace control plane");

    const threadButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Earlier Dispatch work"),
    );
    expect(threadButton).toBeDefined();
    await act(async () => {
      threadButton?.click();
    });
    expect(clientState.switchThread).toHaveBeenCalledWith("older-thread");

    const newChatButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("New chat"),
    );
    expect(newChatButton).toBeDefined();
    await act(async () => {
      newChatButton?.click();
    });
    expect(clientState.createThread).toHaveBeenCalledOnce();
    expect(clientState.switchThread).toHaveBeenCalledWith("new-thread");
  });
});

function readUnprefixedZIndexClass(className: string): number | null {
  const match = className.match(/(?:^|\s)z-\[?(\d+)\]?(?=\s|$)/);
  return match ? Number(match[1]) : null;
}

function readMobileZIndexClass(className: string): number | null {
  const match = className.match(/max-\[767px\]:z-\[?(\d+)\]?(?=\s|$)/);
  return match ? Number(match[1]) : null;
}

describe("chat-first surface panel toggle stacking", () => {
  it("keeps the toggle above the mobile full-screen surface panel overlay", async () => {
    const { ChatFirstSurfacePanelToggle: RealChatFirstSurfacePanelToggle } =
      await vi.importActual<
        typeof import("@agent-native/toolkit/app/chat/chat-first")
      >("@agent-native/toolkit/app/chat/chat-first");
    const { ChatFirstSurfacePanel } =
      await import("@agent-native/toolkit/app/chat/chat-first");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <>
          <ChatFirstSurfacePanel width={320} onResizePointerDown={() => {}}>
            <div>side surface content</div>
          </ChatFirstSurfacePanel>
          <RealChatFirstSurfacePanelToggle
            open={false}
            onToggle={() => {}}
            className={CHAT_FIRST_SURFACE_PANEL_TOGGLE_CLASS_NAME}
          />
        </>,
      );
    });

    const panelClassName =
      container.querySelector("[data-chat-first-surface-panel]")?.className ??
      "";
    const toggleClassName =
      container.querySelector("[data-chat-first-surface-toggle]")?.className ??
      "";

    const panelMobileZIndex = readMobileZIndexClass(panelClassName);
    const toggleZIndex = readUnprefixedZIndexClass(toggleClassName);
    expect(panelMobileZIndex).not.toBeNull();
    expect(toggleZIndex).not.toBeNull();
    expect(toggleZIndex as number).toBeGreaterThan(panelMobileZIndex as number);

    act(() => root.unmount());
    container.remove();
  });
});

describe("chat-first app surface tab chat rail", () => {
  const registration = { id: "mail", name: "Mail", path: "/mail" };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function renderAppTab(
    isMobileSurface: boolean,
    placement?: "main" | "side",
  ) {
    const { defaultChatFirstCopy } =
      await import("@agent-native/toolkit/app/chat/chat-first");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        renderChatFirstAppSurfaceTab({
          registration,
          embedPath: "/mail",
          loading: false,
          isMobileSurface,
          copy: defaultChatFirstCopy,
          ...(placement ? { placement } : {}),
        }),
      );
    });
    return { container, root };
  }

  it("does not mount a second full-screen chat rail while the mobile surface panel already covers the screen", async () => {
    const { container, root } = await renderAppTab(true);

    expect(container.querySelector("[data-agent-sidebar]")).toBeNull();
    expect(
      container.querySelector("[data-chat-first-app-pane]"),
    ).not.toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it("shows an app beside the chat without a second chat rail, so the app gets the panel", async () => {
    const { container, root } = await renderAppTab(false, "side");

    expect(container.querySelector("[data-agent-sidebar]")).toBeNull();
    expect(
      container.querySelector("[data-chat-first-app-pane]"),
    ).not.toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it("gives an app that takes the main area its own chat rail", async () => {
    const { container, root } = await renderAppTab(false, "main");

    expect(container.querySelector("[data-agent-sidebar]")).not.toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it("still gives the app its own chat rail on desktop, where the surface panel is inline", async () => {
    const { container, root } = await renderAppTab(false);

    expect(container.querySelector("[data-agent-sidebar]")).not.toBeNull();

    act(() => root.unmount());
    container.remove();
  });
});
