// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminShell } from "../admin-navigation";
import { TooltipProvider } from "../ui/tooltip";
import {
  buildChatFirstEmbedSessionInput,
  CHAT_FIRST_SURFACE_PANEL_TOGGLE_CLASS_NAME,
  formatThreadAge,
  isElectronEmbeddedSearch,
  NavContent,
  renderChatFirstAppSurfaceTab,
  shouldAutoCollapseDispatchSidebar,
} from "./Layout";

const clientState = vi.hoisted(() => ({
  createThread: vi.fn<() => Promise<string | null>>(),
  switchThread: vi.fn(),
  threads: [] as Array<Record<string, unknown>>,
  workspaceApps: [] as Array<Record<string, unknown>>,
  // Stable identity: WorkspaceAppFrame's embed effect depends on this
  // function, so a fresh mock per render would re-run the effect forever.
  createEmbedSessionMutateAsync: vi
    .fn()
    .mockResolvedValue({ startUrl: "about:blank" }),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  AgentSidebar: ({ children }: { children: React.ReactNode }) => (
    <div data-agent-sidebar>{children}</div>
  ),
  ExternalAgentNudge: () => null,
  focusAgentChat: vi.fn(),
  navigateWithAgentChatViewTransition: (
    navigate: (path: string) => void,
    path: string,
  ) => navigate(path),
  useAgentChatHomeHandoff: () => false,
  useAgentChatHomeHandoffLinks: vi.fn(),
  useChatThreads: () => ({
    threads: clientState.threads,
    activeThreadId: "active-thread",
    isLoading: false,
    createThread: clientState.createThread,
    switchThread: clientState.switchThread,
    renameThread: vi.fn(),
    refreshThreads: vi.fn(),
  }),
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
  appBasePath: () => "",
  appPath: (path: string) => path,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (action: string) => ({
    data:
      action === "list-workspace-apps" ? clientState.workspaceApps : undefined,
    isLoading: false,
  }),
  useActionMutation: () => ({
    mutateAsync: clientState.createEmbedSessionMutateAsync,
  }),
}));

vi.mock("@agent-native/core/client/feature-flags", () => ({
  useFeatureFlag: () => false,
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, unknown>) => {
    const messages: Record<string, string> = {
      "dispatch.nav.chat": "Chat",
      "dispatch.nav.overview": "Overview",
      "dispatch.nav.apps": "Apps",
      "dispatch.nav.agents": "Agents",
      "dispatch.pages.workspaceApps": "Workspace apps",
      "dispatch.nav.operate": "Operate",
      "dispatch.nav.advanced": "Advanced",
      "dispatch.sidebar.newChat": "New chat",
      "dispatch.sidebar.newDispatchChat": "New Dispatch chat",
      "dispatch.sidebar.renameChat": "Rename chat",
      "dispatch.sidebar.chatOptions": `Options for ${values?.title ?? ""}`,
      "dispatch.sidebar.renameThread": `Rename ${values?.title ?? ""}`,
      "sidebar.collapseSidebar": "Collapse sidebar",
      "sidebar.expandSidebar": "Expand sidebar",
    };
    return messages[key] ?? String(values?.defaultValue ?? key);
  },
}));

vi.mock("@agent-native/core/client/navigation", () => ({
  openCommandMenu: vi.fn(),
}));

vi.mock("@agent-native/core/client/ui", () => ({
  AgentNativeIcon: (props: React.SVGProps<SVGSVGElement>) => (
    <svg data-agent-native-icon {...props} />
  ),
  FeedbackButton: () => <div>Feedback</div>,
}));

vi.mock("@agent-native/core/client/org", () => ({
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

describe("formatThreadAge", () => {
  const now = 2_000_000_000_000;

  it.each([
    [0, "now"],
    [2 * 60 * 60_000, "2h"],
    [7 * 24 * 60 * 60_000, "7d"],
    [21 * 24 * 60 * 60_000, "3w"],
    [365 * 24 * 60 * 60_000, "1y"],
  ])("formats %i milliseconds as %s", (elapsed, expected) => {
    expect(formatThreadAge(now - elapsed, now)).toBe(expected);
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
    clientState.threads = [
      {
        id: "active-thread",
        title: "Current Dispatch work",
        messageCount: 2,
        updatedAt: Date.now(),
        createdAt: Date.now(),
      },
      {
        id: "older-thread",
        title: "Earlier Dispatch work",
        messageCount: 1,
        updatedAt: Date.now() - 5 * 60_000,
        createdAt: Date.now() - 5 * 60_000,
        source: { platform: "slack", url: "https://example.slack.com/thread" },
      },
    ];
    clientState.workspaceApps = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

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
              <NavContent chatFirstMode={chatFirstMode} collapsed={collapsed} />
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
      const footerActions = footer?.querySelector(
        "[data-sidebar-footer-actions]",
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
      expect(footerActions).not.toBeNull();
      expect(adminLink!.compareDocumentPosition(settingsLink!)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(settingsLink!.compareDocumentPosition(organization!)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(organization!.compareDocumentPosition(footerActions!)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
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

    const sidebarLabel = container.querySelector(
      "[data-dispatch-sidebar-label]",
    );
    expect(sidebarLabel?.textContent?.trim()).toBe("Dispatch");
    expect(container.textContent).not.toContain("Agent-Native Dispatch");
    expect(
      sidebarLabel?.closest('a[data-dispatch-logo][href="/overview"]'),
    ).not.toBeNull();

    const settingsLink = container.querySelector('a[href="/settings"]');
    const adminLink = container.querySelector('a[href="/admin"]');
    const organization = [...container.querySelectorAll("div")].find(
      (element) => element.textContent?.trim() === "Organization",
    );
    const footerActions = container.querySelector(
      "[data-sidebar-footer-actions]",
    );

    expect(settingsLink).not.toBeNull();
    expect(adminLink).not.toBeNull();
    expect(organization).toBeDefined();
    expect(footerActions).not.toBeNull();
    expect(settingsLink!.compareDocumentPosition(organization!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(adminLink!.compareDocumentPosition(settingsLink!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(organization!.compareDocumentPosition(footerActions!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
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

    expect(container.querySelectorAll("[data-chat-first-app]")).toHaveLength(5);
    const showMore = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Show more",
    );
    expect(showMore).toBeDefined();
    await act(async () => {
      showMore?.click();
    });
    expect(container.querySelectorAll("[data-chat-first-app]")).toHaveLength(6);

    const allApps = container.querySelector<HTMLButtonElement>(
      "[data-chat-first-all-apps]",
    );
    expect(allApps?.textContent?.trim()).toBe("All apps");
    await act(async () => {
      allApps?.click();
    });
    expect(paths.at(-1)).toBe("/apps");
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
    expect(
      container.querySelector("[data-sidebar-footer-feedback]"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-sidebar-footer-collapse]"),
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
    expect(container.textContent).toContain("5m");
    expect(container.querySelector('[aria-label="Slack"]')).not.toBeNull();
    const sourceToggle = container.querySelector(
      "[data-dispatch-chat-source-toggle]",
    ) as HTMLButtonElement;
    expect(sourceToggle.getAttribute("aria-pressed")).toBe("false");
    await act(async () => {
      sourceToggle.click();
    });
    expect(sourceToggle.getAttribute("aria-pressed")).toBe("true");
    const age = [...container.querySelectorAll("span")].find(
      (element) => element.textContent === "5m",
    );
    expect(age?.className).toContain("an-chat-history-row__timestamp");
    const historyList = container.querySelector(
      '[data-agent-native="chat-history-list"]',
    );
    expect(historyList?.className).toContain("an-chat-history--rail");
    const sidebarLogo = container.querySelector(
      "a[data-dispatch-logo] svg[data-agent-native-icon]",
    );
    expect(sidebarLogo?.className).toContain("text-foreground");
    expect(sidebarLogo?.className).toContain("h-[17px]");
    expect(sidebarLogo?.className).toContain("w-[30px]");
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
        typeof import("@agent-native/core/client/agent-chat")
      >("@agent-native/core/client/agent-chat");
    const { ChatFirstSurfacePanel } =
      await import("@agent-native/core/client/chat-first");

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

    // Below 768px the panel becomes a full-screen absolute overlay at this
    // z-index (surface-panel.tsx). The toggle is the only control that can
    // dismiss it, so it must always paint above that overlay.
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

  async function renderAppTab(isMobileSurface: boolean) {
    const { defaultChatFirstCopy } =
      await import("@agent-native/core/client/chat-first");
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
        }),
      );
    });
    return { container, root };
  }

  it("does not mount a second full-screen chat rail while the mobile surface panel already covers the screen", async () => {
    const { container, root } = await renderAppTab(true);

    // ChatFirstSurfacePanel is already a full-screen overlay below 768px
    // (surface-panel.tsx). A nested AgentSidebar chat rail here would stack a
    // second full-screen shell on top of it.
    expect(container.querySelector("[data-agent-sidebar]")).toBeNull();
    expect(
      container.querySelector("[data-chat-first-app-pane]"),
    ).not.toBeNull();

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
