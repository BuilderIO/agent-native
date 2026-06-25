import {
  AgentSidebar,
  focusAgentChat,
  navigateWithAgentChatViewTransition,
  useAgentChatHomeHandoff,
  useAgentChatHomeHandoffLinks,
  useT,
} from "@agent-native/core/client";
import { IconMenu2 } from "@tabler/icons-react";
import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { APP_TITLE } from "@/lib/app-config";
import { TAB_ID } from "@/lib/tab-id";

import { Header } from "./Header";
import { HeaderActionsProvider } from "./HeaderActions";
import { Sidebar } from "./Sidebar";

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
    pathname === "/" ||
    pathname.startsWith("/chat/") ||
    pathname === "/database" ||
    pathname.startsWith("/extensions")
  );
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const isChatRoute =
    location.pathname === "/" || location.pathname.startsWith("/chat/");
  const chatHomeHandoffActive = useAgentChatHomeHandoff({
    storageKey: "chat",
    activePath: location.pathname,
    enabled: !isChatRoute,
  });
  useAgentChatHomeHandoffLinks({
    storageKey: "chat",
    isChatPath: (pathname) => pathname === "/" || pathname.startsWith("/chat/"),
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
  function openAskAgentFullscreen() {
    focusAgentChat();
    navigateWithAgentChatViewTransition(navigate, "/");
  }

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
        <Header onOpenMobileSidebar={() => setMobileSidebarOpen(true)} />
      )}
      <main className="min-w-0 flex-1 overflow-y-auto overscroll-contain">
        {children}
      </main>
    </div>
  );

  return (
    <HeaderActionsProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        <div className="hidden md:block">
          <Sidebar
            collapsed={sidebarCollapsed}
            onCollapsedChange={setSidebarCollapsed}
          />
        </div>
        <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
          <SheetContent side="left" className="p-0 w-[260px]">
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
          contentFrame
        ) : (
          <AgentSidebar
            position="right"
            chatViewTransition
            storageKey="chat"
            browserTabId={TAB_ID}
            openOnChatRunning={chatHomeHandoffActive}
            onFullscreenRequest={openAskAgentFullscreen}
            emptyStateText={t("chat.inspectEmptyState")}
            suggestions={[
              t("chat.inspectSuggestionCapabilities"),
              t("chat.inspectSuggestionHello"),
              t("chat.inspectSuggestionAction"),
            ]}
          >
            {contentFrame}
          </AgentSidebar>
        )}
      </div>
    </HeaderActionsProvider>
  );
}
