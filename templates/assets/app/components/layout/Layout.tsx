import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { IconMenu2 } from "@tabler/icons-react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { HeaderActionsProvider } from "./HeaderActions";
import {
  AgentSidebar,
  focusAgentChat,
  getBrowserTabId,
  isEmbedAuthActive,
  navigateWithAgentChatViewTransition,
  useAgentChatHomeHandoff,
  useAgentChatHomeHandoffLinks,
} from "@agent-native/core/client";
import { InvitationBanner } from "@agent-native/core/client/org";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { ASSETS_CHAT_STORAGE_KEY } from "@/lib/chat";
import { cn } from "@/lib/utils";

interface LayoutProps {
  children: React.ReactNode;
}

function isEmbeddedWindow() {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function Layout({ children }: LayoutProps) {
  useNavigationState();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const isCreateRoute = location.pathname === "/";
  const chatHomeHandoffActive = useAgentChatHomeHandoff({
    storageKey: ASSETS_CHAT_STORAGE_KEY,
    activePath: location.pathname,
    enabled: !isCreateRoute,
  });
  useAgentChatHomeHandoffLinks({
    storageKey: ASSETS_CHAT_STORAGE_KEY,
    chatPath: "/",
  });

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  const isPicker = location.pathname === "/library";
  const hideHeader =
    location.pathname === "/library" ||
    location.pathname === "/extensions" ||
    location.pathname.startsWith("/extensions/");
  const chromeless =
    (isPicker && (isEmbeddedWindow() || isEmbedAuthActive())) ||
    location.pathname.endsWith("/embed");

  if (chromeless) {
    return (
      <HeaderActionsProvider>
        <div className="h-screen w-full overflow-hidden bg-background text-foreground">
          {children}
        </div>
      </HeaderActionsProvider>
    );
  }

  const appFrame = (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 md:static md:z-auto",
          mobileSidebarOpen
            ? "translate-x-0"
            : "-translate-x-full md:translate-x-0",
        )}
      >
        <Sidebar />
      </div>
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile-only top bar with hamburger */}
        <div className="flex h-12 shrink-0 items-center border-b border-border bg-sidebar px-4 md:hidden">
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="-ml-1 mr-3 cursor-pointer rounded-md p-2.5 hover:bg-sidebar-accent/50"
            aria-label="Open navigation"
          >
            <IconMenu2 className="h-5 w-5 text-foreground" />
          </button>
          <span className="text-base font-bold tracking-tight">Assets</span>
        </div>
        {!hideHeader && <Header />}
        <InvitationBanner />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );

  if (isCreateRoute) {
    return <HeaderActionsProvider>{appFrame}</HeaderActionsProvider>;
  }

  function openCreateChatFullscreen() {
    focusAgentChat();
    navigateWithAgentChatViewTransition(navigate, "/");
  }

  return (
    <HeaderActionsProvider>
      <AgentSidebar
        position="right"
        chatViewTransition
        storageKey={ASSETS_CHAT_STORAGE_KEY}
        browserTabId={getBrowserTabId()}
        openOnChatRunning={chatHomeHandoffActive}
        onFullscreenRequest={openCreateChatFullscreen}
        emptyStateText="Describe the asset you want to make"
        suggestions={[
          "Generate 3 blog heroes from this brand kit",
          "Make an 8-second product reveal video",
          "Match the style of my reference assets",
        ]}
      >
        {appFrame}
      </AgentSidebar>
    </HeaderActionsProvider>
  );
}
