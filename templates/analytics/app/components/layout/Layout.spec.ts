import { readFileSync } from "node:fs";

import {
  ChatHistoryRail,
  type ChatHistoryRailProps,
} from "@agent-native/toolkit/chat-history/ChatHistoryRail";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ auth: null, isLoading: true }),
}));
vi.mock("@/hooks/use-user-pref", () => ({
  useUserPref: () => ({
    data: {},
    isLoading: false,
    isSuccess: true,
    save: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-dashboard-views", () => ({
  useDashboardViews: () => ({ views: [] }),
  useDeleteDashboardView: () => vi.fn(),
}));
vi.mock("@/lib/item-popularity", () => ({
  usePopularity: () => ({ data: {}, isReady: true }),
  popularityOf: () => 0,
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useChangeVersions: () => 0,
  useActionMutation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  useChatThreads: () => ({
    threads: [],
    isNewThread: () => false,
    pinThread: vi.fn(),
    renameThread: vi.fn(),
    archiveThread: vi.fn(),
  }),
  navigateWithAgentChatViewTransition: vi.fn(),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/toolkit/app/chat/ownership-history", () => ({
  ownDraftRows: () => [],
  useOwnershipChatHistory: () => ({
    sections: [
      {
        id: "mine",
        label: "My chats",
        items: [{ id: "mine", title: "Owner chat" }],
        previewCount: 5,
      },
      {
        id: "shared",
        label: "Shared with you",
        items: [
          {
            id: "shared",
            title: "Shared chat",
            ownerLabel: "Owned by owner@example.test",
            accessLabel: "Shared directly",
            hideActions: true,
          },
        ],
        previewCount: 5,
      },
    ],
    listProps: {},
  }),
  OwnershipChatHistoryRail: ({
    listProps,
    railLabels,
    ...props
  }: ChatHistoryRailProps & { listProps: object }) =>
    createElement(ChatHistoryRail, {
      ...listProps,
      ...props,
      railLabels: {
        ...railLabels,
        sections: {
          showAll: "Show all",
          showLess: "Show less",
          loadMore: "Load more",
          loadingMore: "Loading",
          retry: "Retry",
        },
      },
    } as ChatHistoryRailProps),
}));
vi.mock("@agent-native/toolkit/app/shared", () => ({
  AppSidebarHeader: () => null,
  AppSidebarFooter: () => null,
}));
vi.mock("@agent-native/toolkit/app/org", () => ({ OrgSwitcher: () => null }));
vi.mock("@agent-native/toolkit/app/feedback", () => ({
  FeedbackButton: () => null,
}));
vi.mock("@agent-native/toolkit/app/db-admin", () => ({
  DevDatabaseLink: () => null,
}));
vi.mock("./NewDashboardDialog", () => ({ NewDashboardDialog: () => null }));

import { TooltipProvider } from "@/components/ui/tooltip";

import {
  isAnalyticsSessionsRoute,
  isSessionReplayRoute,
  resolveAskNavigationAction,
  shouldDefaultOpenAnalyticsSidebar,
} from "./layout-route-policy";
import { Sidebar } from "./Sidebar";

describe("Analytics layout sidebar route policy", () => {
  it("keeps the right agent sidebar closed by default on session routes", () => {
    expect(isAnalyticsSessionsRoute("/sessions")).toBe(true);
    expect(isAnalyticsSessionsRoute("/sessions/sr_123")).toBe(true);
    expect(shouldDefaultOpenAnalyticsSidebar("/sessions")).toBe(false);
    expect(shouldDefaultOpenAnalyticsSidebar("/sessions/sr_123")).toBe(false);
  });

  it("leaves the header, with its agent toggle, on sessions pages that are not one replay", () => {
    expect(isSessionReplayRoute("/sessions/sr_123")).toBe(true);
    expect(isSessionReplayRoute("/sessions")).toBe(false);
    expect(isSessionReplayRoute("/sessions/performance")).toBe(false);
    expect(isSessionReplayRoute("/sessions/events/")).toBe(false);
  });

  it("keeps the right agent sidebar closed on dashboard routes", () => {
    expect(isAnalyticsSessionsRoute("/ask")).toBe(false);
    expect(isAnalyticsSessionsRoute("/dashboards/revenue")).toBe(false);
    expect(shouldDefaultOpenAnalyticsSidebar("/dashboards/revenue")).toBe(
      false,
    );
  });

  it("keeps sidebar navigation compact and footer gutters aligned", () => {
    const source = readFileSync(
      new URL("./Sidebar.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      'className="flex min-h-0 flex-1 flex-col overflow-hidden py-2"',
    );
    expect(source).toContain(
      'className="min-h-0 min-w-0 flex flex-1 flex-col space-y-0.5 overflow-x-hidden overflow-y-auto px-2 py-3"',
    );
    expect(source).toContain('<div className="mt-3 shrink-0 min-w-0">');
    expect(source).not.toContain("bottomItems");
    expect(source).not.toContain('href: "/settings"');
    expect(source).toContain('className="border-border/70 px-2"');
    expect(source).toContain(
      'className="min-w-0 flex-1 !px-2 !bg-transparent !text-primary hover:!bg-accent/60 hover:!text-primary"',
    );
    expect(source).toContain("<AppSidebarHeader");
    expect(source).toContain("<AppSidebarFooter");
    expect(source).not.toContain(
      'className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden py-2"',
    );
    expect(source).not.toContain(
      'className="mt-auto min-w-0 px-2 pt-2 text-sm font-medium lg:px-4"',
    );
  });

  it("makes Ask a route-aware toggle while preserving modified-link behavior", () => {
    expect(resolveAskNavigationAction(false, false)).toBe("navigate");
    expect(resolveAskNavigationAction(true, false)).toBe("toggle");
    expect(resolveAskNavigationAction(false, true)).toBe("browser");
    expect(resolveAskNavigationAction(true, true)).toBe("browser");

    const source = readFileSync(
      new URL("./Sidebar.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("onClick: handleAskClick");
    expect(source).toContain("onClick={handleAskClick}");
    expect(source).toContain("open={askOpen}");
    expect(source).not.toContain("open={askOpen && isAskRoute}");
  });

  it("shows Mine and Shared history without an Ask visibility filter", () => {
    const queryClient = new QueryClient();
    const markup = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          MemoryRouter,
          { initialEntries: ["/ask"] },
          createElement(TooltipProvider, null, createElement(Sidebar)),
        ),
      ),
    );
    const askStart = markup.indexOf('href="/ask"');
    const sessionsStart = markup.indexOf('href="/sessions"', askStart);
    expect(askStart).toBeGreaterThan(-1);
    expect(sessionsStart).toBeGreaterThan(askStart);
    const askSection = markup.slice(askStart, sessionsStart);
    expect(askSection).toContain("My chats");
    expect(askSection).toContain("Owner chat");
    expect(askSection).toContain("Shared with you");
    expect(askSection).toContain("Owned by owner@example.test");
    expect(askSection).not.toContain('aria-label="sidebar.sectionSettings"');
    expect(markup).toContain('aria-label="sidebar.sectionSettings"');
    queryClient.clear();
  });

  it("renews an active Ask handoff on route entry before the heartbeat interval", () => {
    const source = readFileSync(
      new URL("./Layout.tsx", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("if (!isAskRoute) return;");
    const end = source.indexOf(
      "return () => window.clearInterval(interval);",
      start,
    );
    const effectSource = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(effectSource).toContain("const refreshHandoff = () =>");
    expect(effectSource.indexOf("refreshHandoff();")).toBeLessThan(
      effectSource.indexOf("window.setInterval("),
    );
  });

  it("keeps both collapsed and expanded sidebar spacing compact", () => {
    const source = readFileSync(
      new URL("./Sidebar.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      'className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto px-2 py-3"',
    );
    expect(source).toContain(
      'className="min-h-0 min-w-0 flex flex-1 flex-col space-y-0.5 overflow-x-hidden overflow-y-auto px-2 py-3"',
    );
  });
});
