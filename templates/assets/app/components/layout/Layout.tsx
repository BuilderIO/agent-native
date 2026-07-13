import {
  AgentSidebar,
  focusAgentChat,
  getBrowserTabId,
  isEmbedAuthActive,
  navigateWithAgentChatViewTransition,
  useAgentChatHomeHandoff,
  useAgentChatHomeHandoffLinks,
  useT,
} from "@agent-native/core/client";
import { InvitationBanner } from "@agent-native/core/client/org";
import {
  EMBED_MODE_QUERY_PARAM,
  EMBED_TOKEN_QUERY_PARAM,
} from "@agent-native/core/shared";
import { HeaderActionsProvider } from "@agent-native/toolkit/app-shell";
import { IconMenu2 } from "@tabler/icons-react";
import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router";

import { GenerationResults } from "@/components/generation/GenerationResults";
import { useImageModelMenu } from "@/hooks/use-image-model-menu";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { ASSETS_CHAT_STORAGE_KEY } from "@/lib/chat";
import { cn } from "@/lib/utils";

import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

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

function searchParamsEnableEmbeddedMode(search: string): boolean {
  const params = new URLSearchParams(search);
  const embedMode = params.get(EMBED_MODE_QUERY_PARAM);
  return (
    params.has(EMBED_TOKEN_QUERY_PARAM) ||
    embedMode === "1" ||
    embedMode === "true"
  );
}

export function Layout({ children }: LayoutProps) {
  useNavigationState();
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();
  const imageModelMenu = useImageModelMenu();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const isCreateRoute =
    location.pathname === "/" || location.pathname.startsWith("/chat/");
  const chatHomeHandoffActive = useAgentChatHomeHandoff({
    storageKey: ASSETS_CHAT_STORAGE_KEY,
    activePath: location.pathname,
    enabled: !isCreateRoute,
  });
  useAgentChatHomeHandoffLinks({
    storageKey: ASSETS_CHAT_STORAGE_KEY,
    isChatPath: (pathname) => pathname === "/" || pathname.startsWith("/chat/"),
  });

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  const isPicker = location.pathname === "/library";
  const hideHeader =
    location.pathname === "/library" ||
    location.pathname.startsWith("/library/") ||
    location.pathname === "/extensions" ||
    location.pathname.startsWith("/extensions/");
  const chromeless =
    (isPicker &&
      (searchParamsEnableEmbeddedMode(location.search) ||
        isEmbeddedWindow() ||
        isEmbedAuthActive())) ||
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
    <div className="agent-layout-shell flex h-screen w-full overflow-hidden bg-background text-foreground">
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}
      <div
        className={cn(
          "agent-layout-left-drawer fixed inset-y-0 start-0 z-50 transition-transform duration-200 ease-out md:static md:z-auto md:transition-none",
          mobileSidebarOpen
            ? "translate-x-0"
            : "-translate-x-full md:translate-x-0",
        )}
      >
        <Sidebar />
      </div>
      <div className="agent-layout-main-surface flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile-only top bar with hamburger */}
        <div className="flex h-12 shrink-0 items-center border-b border-border bg-sidebar px-4 md:hidden">
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="-ms-1 me-3 cursor-pointer rounded-md p-2.5 hover:bg-sidebar-accent/50"
            aria-label={t("navigation.openNavigation")}
          >
            <IconMenu2 className="h-5 w-5 text-foreground" />
          </button>
          <span className="text-base font-bold tracking-tight">
            {t("navigation.brand")}
          </span>
        </div>
        {!hideHeader && <Header />}
        <InvitationBanner />
        <main className="agent-native-app-main min-h-0 flex-1 overflow-y-auto">
          {children}
        </main>
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
        emptyStateText={t("chat.emptyState")}
        agentPageHref="/agent"
        suggestions={[
          t("chat.suggestionBlogHeroes"),
          t("chat.suggestionProductVideo"),
          t("chat.suggestionReferenceStyle"),
        ]}
        threadFooterSlot={({ threadId }) => (
          <GenerationResults threadId={threadId} />
        )}
        imageModelMenu={imageModelMenu}
      >
        {appFrame}
      </AgentSidebar>
    </HeaderActionsProvider>
  );
}
