import { useState, useEffect } from "react";
import { useLocation } from "react-router";
import { IconMenu2 } from "@tabler/icons-react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { HeaderActionsProvider } from "./HeaderActions";
import { AgentSidebar } from "@agent-native/core/client";
import { consumePlanChatHomeHandoff } from "@/lib/chat-home-handoff";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";

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
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [chatHomeHandoffPath] = useState(() =>
    consumePlanChatHomeHandoff() ? location.pathname : null,
  );
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
  const chatHomeHandoffActive = chatHomeHandoffPath === location.pathname;
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

  const pageContent = (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      {ownsToolbar ? (
        hideAppNavigation ? null : (
          <div className="flex h-12 items-center border-b border-border px-4 md:hidden shrink-0">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open navigation"
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
            >
              <IconMenu2 className="h-4 w-4" />
            </button>
          </div>
        )
      ) : (
        <Header onOpenMobileSidebar={() => setMobileSidebarOpen(true)} />
      )}
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );

  return (
    <HeaderActionsProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        {!hideAppNavigation && (
          <div className="hidden md:block">
            <Sidebar
              collapsed={effectiveSidebarCollapsed}
              onCollapsedChange={setEffectiveSidebarCollapsed}
            />
          </div>
        )}
        <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
          <SheetContent side="left" className="p-0 w-[260px]">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">
              App navigation links
            </SheetDescription>
            <Sidebar collapsed={false} collapsible={false} />
          </SheetContent>
        </Sheet>
        {chatRoute ? (
          pageContent
        ) : (
          <AgentSidebar
            position="right"
            defaultOpen={false}
            chatViewTransition
            storageKey="plans"
            openOnChatRunning={chatHomeHandoffActive}
            emptyStateText="Ask the Plan agent to search merged PR recaps, inspect this document, add diagrams, or answer code questions as visual plans."
            suggestions={[
              "What shipped in the last week?",
              "What does this UI look like?",
              "What is the shape of this API?",
            ]}
          >
            {pageContent}
          </AgentSidebar>
        )}
      </div>
    </HeaderActionsProvider>
  );
}
