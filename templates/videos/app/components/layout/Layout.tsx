import { AgentSidebar, useT } from "@agent-native/core/client";
import { InvitationBanner } from "@agent-native/core/client/org";
import { IconMenu2 } from "@tabler/icons-react";
import { useState, useEffect } from "react";
import { useLocation } from "react-router";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

import { Header } from "./Header";
import { HeaderActionsProvider } from "./HeaderActions";
import { NavSidebar } from "./NavSidebar";

interface LayoutProps {
  children: React.ReactNode;
}

const SIDEBAR_COLLAPSE_KEY = "videos.sidebar.collapsed";

function readSidebarCollapsed() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Routes whose page renders its own h-12 toolbar (with title + AgentToggleButton).
 * Layout still wraps these with the AgentSidebar but skips the global Header
 * and the left NavSidebar so they don't double-stack chrome.
 *
 * - Studio routes (`/`, `/c/:id`) render their own complex sidebar + StudioHeader
 *   inside `pages/Index.tsx`.
 * - Extensions routes (`/extensions`, `/extensions/:id`) render the framework.s extensions toolbar.
 */
function studioRoute(pathname: string): boolean {
  if (pathname === "/") return true;
  if (pathname.startsWith("/c/")) return true;
  return false;
}

function routeOwnsToolbar(pathname: string): boolean {
  if (studioRoute(pathname)) return true;
  if (pathname.startsWith("/extensions")) return true;
  return false;
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const t = useT();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] =
    useState(readSidebarCollapsed);

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

  const isStudio = studioRoute(location.pathname);
  const ownsToolbar = routeOwnsToolbar(location.pathname);

  // Studio routes own their entire chrome (header + sidebar + agent sidebar
  // are mounted inside pages/Index.tsx so AgentToggleButton can sit in the
  // StudioHeader). Render the page directly.
  if (isStudio) {
    return <HeaderActionsProvider>{children}</HeaderActionsProvider>;
  }

  return (
    <HeaderActionsProvider>
      <div className="agent-layout-shell flex h-screen w-full overflow-hidden bg-background text-foreground">
        <div className="agent-layout-left-drawer hidden md:block">
          <NavSidebar
            collapsed={sidebarCollapsed}
            onCollapsedChange={setSidebarCollapsed}
          />
        </div>
        <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
          <SheetContent side="left" className="p-0 w-[260px]">
            <SheetTitle className="sr-only">
              {t("sidebar.navigation")}
            </SheetTitle>
            <NavSidebar collapsed={false} collapsible={false} />
          </SheetContent>
        </Sheet>
        <AgentSidebar
          position="right"
          defaultOpen
          emptyStateText={t("agent.emptyState")}
          suggestions={[
            t("agent.suggestionLogo"),
            t("agent.suggestionZoom"),
            t("agent.suggestionSlow"),
          ]}
        >
          <div className="flex h-full flex-1 flex-col overflow-hidden">
            {ownsToolbar ? (
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
            ) : (
              <Header onOpenMobileSidebar={() => setMobileSidebarOpen(true)} />
            )}
            <InvitationBanner />
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
        </AgentSidebar>
      </div>
    </HeaderActionsProvider>
  );
}
