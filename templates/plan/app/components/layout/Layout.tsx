import {
  AgentSidebar,
  useAgentChatHomeHandoff,
  useAgentChatHomeHandoffLinks,
  useT,
} from "@agent-native/core/client";
import { HeaderActionsProvider } from "@agent-native/toolkit/app-shell";
import { IconMenu2 } from "@tabler/icons-react";
import { useState, useEffect } from "react";
import { useLocation } from "react-router";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";

import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

const PLAN_READER_VIEW_EVENT = "plans-reader-view-change";

interface LayoutProps {
  children: React.ReactNode;
}

/**
 * Routes whose page renders its own h-12 toolbar (with title + AgentToggleButton).
 * Layout still wraps these with the left Sidebar and AgentSidebar but skips the
 * global Header so they don't double-stack a header bar.
 */
function routeOwnsToolbar(pathname: string): boolean {
  return pathname.startsWith("/extensions") || isPlanDetailRoute(pathname);
}

// Recaps are a kind of plan: `/plans/:id` and `/recaps/:id` both render
// PlansPage and share the immersive full-screen reader, so the layout must
// treat them identically (matching `viewForPath` in use-navigation-state.ts).
// Without `/recaps/` here, recap routes never owned their toolbar and never
// went immersive — they were stuck in app view and the full-screen toggle did
// nothing.
function isPlanDetailRoute(pathname: string): boolean {
  return /^\/(plans|recaps|local-plans)\/[^/]+/.test(pathname);
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const t = useT();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem("plans.sidebarCollapsed.v3");
    return stored ? stored === "true" : true;
  });
  const [chatSidebarCollapsed, setChatSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    const stored = window.localStorage.getItem("plans.chatSidebarCollapsed.v1");
    return stored ? stored === "true" : false;
  });
  const [planReaderImmersive, setPlanReaderImmersive] = useState(() => {
    if (typeof window === "undefined") return false;
    return (
      isPlanDetailRoute(window.location.pathname) &&
      window.document.documentElement.dataset.planReaderView !== "app"
    );
  });

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    window.localStorage.setItem(
      "plans.sidebarCollapsed.v3",
      String(sidebarCollapsed),
    );
  }, [sidebarCollapsed]);

  useEffect(() => {
    window.localStorage.setItem(
      "plans.chatSidebarCollapsed.v1",
      String(chatSidebarCollapsed),
    );
  }, [chatSidebarCollapsed]);

  const ownsToolbar = routeOwnsToolbar(location.pathname);
  const planDetailRoute = isPlanDetailRoute(location.pathname);
  const chatRoute = location.pathname === "/";
  const chatHomeHandoffActive = useAgentChatHomeHandoff({
    storageKey: "plans",
    activePath: location.pathname,
    enabled: !chatRoute,
  });
  useAgentChatHomeHandoffLinks({ storageKey: "plans", chatPath: "/" });
  const hideAppNavigation = planDetailRoute && planReaderImmersive;
  const effectiveSidebarCollapsed = chatRoute
    ? chatSidebarCollapsed
    : sidebarCollapsed;
  const setEffectiveSidebarCollapsed = chatRoute
    ? setChatSidebarCollapsed
    : setSidebarCollapsed;

  useEffect(() => {
    if (!planDetailRoute) {
      setPlanReaderImmersive(false);
      return;
    }

    const readCurrentView = () => {
      setPlanReaderImmersive(
        window.document.documentElement.dataset.planReaderView !== "app",
      );
    };
    const onPlanReaderView = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          immersive?: boolean;
          view?: "immersive" | "app";
        }>
      ).detail;
      if (typeof detail?.immersive === "boolean") {
        setPlanReaderImmersive(detail.immersive);
        return;
      }
      readCurrentView();
    };

    readCurrentView();
    window.addEventListener(PLAN_READER_VIEW_EVENT, onPlanReaderView);
    return () =>
      window.removeEventListener(PLAN_READER_VIEW_EVENT, onPlanReaderView);
  }, [planDetailRoute]);

  // Embed mode: render just the reader, flowing — no Sidebar, no AgentSidebar,
  // no h-screen shell. Those (some in shared core) lock the embed to the iframe
  // height; bypassing them lets the document flow so the shell sizes to content
  // (see global.css `html[data-embed]` + frame.ts content-height reporting).
  const embedded = new URLSearchParams(location.search).get("embedded") === "1";
  if (embedded) {
    return (
      <HeaderActionsProvider>
        <div className="agent-embed-root flex w-full flex-col bg-background text-foreground">
          {children}
        </div>
      </HeaderActionsProvider>
    );
  }

  const pageContent = (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      {ownsToolbar ? (
        hideAppNavigation ? null : (
          <div className="flex h-12 items-center border-b border-border px-4 md:hidden shrink-0">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label={t("sidebar.openNavigation")}
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
            >
              <IconMenu2 className="h-4 w-4" />
            </button>
          </div>
        )
      ) : (
        <Header onOpenMobileSidebar={() => setMobileSidebarOpen(true)} />
      )}
      <main className="agent-native-app-main flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );

  return (
    <HeaderActionsProvider>
      <div className="agent-layout-shell flex h-screen w-full overflow-hidden bg-background text-foreground">
        {!hideAppNavigation && (
          <div className="agent-layout-left-drawer hidden md:block">
            <Sidebar
              collapsed={effectiveSidebarCollapsed}
              onCollapsedChange={setEffectiveSidebarCollapsed}
            />
          </div>
        )}
        <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
          <SheetContent side="left" className="p-0 w-[260px]">
            <SheetTitle className="sr-only">
              {t("sidebar.navigation")}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {t("sidebar.navigationDescription")}
            </SheetDescription>
            <Sidebar collapsed={false} collapsible={false} />
          </SheetContent>
        </Sheet>
        {chatRoute ? (
          <div className="agent-layout-main-surface flex min-w-0 flex-1 overflow-hidden">
            {pageContent}
          </div>
        ) : (
          <AgentSidebar
            position="right"
            defaultOpen={false}
            chatViewTransition
            storageKey="plans"
            openOnChatRunning={chatHomeHandoffActive}
            agentPageHref="/agent"
            emptyStateText={t("agent.emptyState")}
            suggestions={[
              t("agent.suggestionShipped"),
              t("agent.suggestionUi"),
              t("agent.suggestionApi"),
            ]}
          >
            {pageContent}
          </AgentSidebar>
        )}
      </div>
    </HeaderActionsProvider>
  );
}
