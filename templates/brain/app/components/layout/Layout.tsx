import {
  AgentSidebar,
  focusAgentChat,
  navigateWithAgentChatViewTransition,
  useAgentChatHomeHandoff,
  useAgentChatHomeHandoffLinks,
  useT,
} from "@agent-native/core/client";
import { IconMenu2 } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { Sidebar } from "@/components/layout/Sidebar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { TAB_ID } from "@/lib/tab-id";

const SIDEBAR_COLLAPSE_KEY = "brain.sidebar.collapsed";

function readSidebarCollapsed() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] =
    useState(readSidebarCollapsed);
  const isAskRoute = location.pathname === "/";
  const chatHomeHandoffActive = useAgentChatHomeHandoff({
    storageKey: "brain",
    activePath: location.pathname,
    enabled: !isAskRoute,
  });
  useAgentChatHomeHandoffLinks({ storageKey: "brain", chatPath: "/" });

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SIDEBAR_COLLAPSE_KEY,
        sidebarCollapsed ? "1" : "0",
      );
    } catch {
      // Ignore storage failures; the in-memory preference still works.
    }
  }, [sidebarCollapsed]);

  const sidebarFrame = (
    <>
      <div className="agent-layout-left-drawer hidden md:block">
        <Sidebar
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
        />
      </div>
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="w-[min(18rem,88vw)] p-0">
          <SheetTitle className="sr-only">
            {t("navigation.brainNavigation")}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {t("navigation.brainNavigationDescription")}
          </SheetDescription>
          <Sidebar collapsed={false} collapsible={false} />
        </SheetContent>
      </Sheet>
    </>
  );

  const contentFrame = (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
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
        <span className="text-sm font-semibold">{t("navigation.brand")}</span>
      </div>
      <main className="agent-native-app-main min-w-0 flex-1 overflow-y-auto overscroll-contain">
        {children}
      </main>
    </div>
  );

  if (isAskRoute) {
    return (
      <div className="agent-layout-shell flex h-screen w-full overflow-hidden bg-background text-foreground">
        {sidebarFrame}
        <div className="agent-layout-main-surface flex min-w-0 flex-1 overflow-hidden">
          {contentFrame}
        </div>
      </div>
    );
  }

  function openAskAgentFullscreen() {
    focusAgentChat();
    navigateWithAgentChatViewTransition(navigate, "/");
  }

  return (
    <div className="agent-layout-shell flex h-screen w-full overflow-hidden bg-background text-foreground">
      {sidebarFrame}
      <AgentSidebar
        position="right"
        chatViewTransition
        storageKey="brain"
        browserTabId={TAB_ID}
        openOnChatRunning={chatHomeHandoffActive}
        onFullscreenRequest={openAskAgentFullscreen}
        emptyStateText={t("chat.emptyState")}
        suggestions={[
          t("chat.suggestionSecurity"),
          t("chat.suggestionStaleFacts"),
          t("chat.suggestionSyncProblems"),
        ]}
      >
        {contentFrame}
      </AgentSidebar>
    </div>
  );
}
