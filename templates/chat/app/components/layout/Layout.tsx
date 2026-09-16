import {
  isAgentChatHomeHandoffActive,
  useAgentChatHomeHandoff,
  useAgentChatHomeHandoffLinks,
} from "@agent-native/core/client/agentkit-chat/rail";
import { useT } from "@agent-native/core/client/i18n";
import { HeaderActionsProvider } from "@agent-native/toolkit/app-shell/header-actions";
import { IconMenu2 } from "@tabler/icons-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { APP_TITLE } from "@/lib/app-config";

import { Sidebar } from "./Sidebar";

const Header = lazy(() =>
  import("./Header").then((module) => ({ default: module.Header })),
);
const AgentInspector = lazy(() =>
  import("./AgentInspector").then((module) => ({
    default: module.AgentInspector,
  })),
);

interface LayoutProps {
  children: React.ReactNode;
}

const SIDEBAR_COLLAPSE_KEY = "chat.sidebar.collapsed";

/**
 * Routes whose page renders its own toolbar. Layout still wraps these with the
 * left Sidebar and agent surfaces but skips the global Header so they don't
 * double-stack chrome.
 */
function routeOwnsToolbar(pathname: string): boolean {
  return (
    pathname === "/home" ||
    pathname.startsWith("/chat/") ||
    pathname === "/database" ||
    pathname.startsWith("/extensions")
  );
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const t = useT();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isChatRoute =
    location.pathname === "/home" || location.pathname.startsWith("/chat/");
  const chatHomeHandoffActive = useAgentChatHomeHandoff({
    storageKey: "chat",
    activePath: location.pathname,
    enabled: !isChatRoute,
  });
  const chatHomeHandoffPending = isAgentChatHomeHandoffActive("chat");
  useAgentChatHomeHandoffLinks({
    storageKey: "chat",
    isChatPath: (pathname) =>
      pathname === "/home" || pathname.startsWith("/chat/"),
    requireActiveHandoff: true,
  });

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const closeMobileSidebar = () => setMobileSidebarOpen(false);
    window.addEventListener("agent-chat:open-thread", closeMobileSidebar);
    return () => {
      window.removeEventListener("agent-chat:open-thread", closeMobileSidebar);
    };
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY);
      if (stored !== null) setSidebarCollapsed(stored === "1");
    } catch {
      // Ignore storage access errors; the default collapsed state still works.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SIDEBAR_COLLAPSE_KEY,
        sidebarCollapsed ? "1" : "0",
      );
    } catch {
      // Ignore storage access errors.
    }
  }, [sidebarCollapsed]);

  const ownsToolbar = routeOwnsToolbar(location.pathname);
  const contentFrame = (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      {isChatRoute ? (
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-3 md:hidden">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setMobileSidebarOpen(true)}
            aria-label={t("navigation.openNavigation")}
          >
            <IconMenu2 className="size-4" />
          </Button>
          <span className="truncate text-sm font-semibold">{APP_TITLE}</span>
        </div>
      ) : ownsToolbar ? (
        <div className="flex h-12 shrink-0 items-center border-b border-border px-4 md:hidden">
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            aria-label={t("navigation.openNavigation")}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <IconMenu2 className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <Suspense fallback={<div className="h-12 shrink-0" />}>
          <Header onOpenMobileSidebar={() => setMobileSidebarOpen(true)} />
        </Suspense>
      )}
      <main className="agent-native-app-main min-w-0 flex-1 overflow-y-auto overscroll-contain">
        {children}
      </main>
    </div>
  );

  return (
    <HeaderActionsProvider>
      <div className="agent-layout-shell chat-layout-shell flex h-screen w-full overflow-hidden bg-background text-foreground">
        <div
          data-collapsed={sidebarCollapsed ? "true" : "false"}
          className="agent-layout-left-drawer hidden md:block"
        >
          <Sidebar
            collapsed={sidebarCollapsed}
            onCollapsedChange={setSidebarCollapsed}
          />
        </div>
        <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
          <SheetContent
            side="left"
            className="w-[var(--chat-sidebar-width)] p-0"
          >
            <SheetTitle className="sr-only">
              {t("navigation.navigation")}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {t("navigation.navigationDescription")}
            </SheetDescription>
            <Sidebar collapsed={false} collapsible={false} />
          </SheetContent>
        </Sheet>
        {isChatRoute ? (
          <div
            data-agent-chat-canvas="true"
            className="agent-layout-main-surface flex min-w-0 flex-1 overflow-hidden"
          >
            {contentFrame}
          </div>
        ) : (
          <Suspense fallback={contentFrame}>
            <AgentInspector
              chatHomeHandoffActive={chatHomeHandoffActive}
              chatHomeHandoffPending={chatHomeHandoffPending}
            >
              {contentFrame}
            </AgentInspector>
          </Suspense>
        )}
      </div>
    </HeaderActionsProvider>
  );
}
