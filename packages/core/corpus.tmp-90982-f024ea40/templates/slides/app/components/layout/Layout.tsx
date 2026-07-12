import { AgentSidebar, useT } from "@agent-native/core/client";
import { InvitationBanner } from "@agent-native/core/client/org";
import { HeaderActionsProvider } from "@agent-native/toolkit/app-shell";
import { IconMenu2 } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router";

import { useDecks } from "@/context/DeckContext";
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";
import { TAB_ID } from "@/lib/tab-id";
import { cn } from "@/lib/utils";

import { AgentWorkIndicator } from "./AgentWorkIndicator";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

interface LayoutProps {
  children: React.ReactNode;
}

/** Routes whose pages render their own toolbar — Layout still renders chrome
 * (sidebar + AgentSidebar wrapper) but skips its own Header. */
function pageHasOwnToolbar(pathname: string): boolean {
  if (pathname.startsWith("/deck/")) return true;
  // /extensions (list) and /extensions/<id> (viewer) both render their own headers
  // from @agent-native/core/client/extensions.
  if (pathname === "/extensions" || pathname.startsWith("/extensions/"))
    return true;
  return false;
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const t = useT();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { collapsed: sidebarCollapsed, setCollapsed: setSidebarCollapsed } =
    useSidebarCollapsed();
  const { getDeck } = useDecks();

  // Scope new chats to the deck the user is currently editing. The route
  // is `/deck/:id`; everywhere else (list, presentation) leaves
  // scope null so chats stay in the general pool. Falling back to the
  // raw deck id keeps the chat bound even before the deck object has
  // streamed in — once the title arrives the badge updates in place.
  const deckScope = useMemo(() => {
    const match = location.pathname.match(/^\/deck\/([^/]+)/);
    const deckId = match?.[1];
    if (!deckId) return null;
    const deck = getDeck(deckId);
    return { type: "deck" as const, id: deckId, label: deck?.title || "" };
  }, [location.pathname, getDeck]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 768) setSidebarOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const ownToolbar = pageHasOwnToolbar(location.pathname);

  return (
    <HeaderActionsProvider>
      <AgentSidebar
        position="right"
        defaultOpen
        emptyStateText={t("agent.emptyState")}
        suggestions={[
          t("agent.suggestionPitch"),
          t("agent.suggestionBrand"),
          t("agent.suggestionHero"),
        ]}
        scope={deckScope}
        browserTabId={TAB_ID}
      >
        <div className="agent-layout-shell flex h-screen w-full overflow-hidden bg-background text-foreground">
          {sidebarOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/50 md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}
          <div
            className={cn(
              "agent-layout-left-drawer fixed inset-y-0 start-0 z-50 transition-transform duration-200 ease-out md:static md:z-auto md:transition-none",
              sidebarOpen
                ? "translate-x-0"
                : "-translate-x-full rtl:translate-x-full md:translate-x-0 md:rtl:translate-x-0",
            )}
          >
            <Sidebar
              collapsed={sidebarCollapsed && !sidebarOpen}
              // In the mobile drawer the sidebar is forced expanded, so the
              // desktop collapse toggle would be a silent no-op (worse: it'd
              // mutate the desktop preference). Hide it while the drawer is
              // open.
              onToggleCollapsed={
                sidebarOpen
                  ? undefined
                  : () => setSidebarCollapsed((prev) => !prev)
              }
            />
          </div>
          <div className="agent-layout-main-surface flex h-full flex-1 flex-col overflow-hidden">
            {/* Mobile-only nav strip with hamburger — only when there's no page toolbar */}
            {!ownToolbar && (
              <div className="flex h-12 items-center border-b border-border px-4 md:hidden shrink-0">
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground cursor-pointer"
                  aria-label={t("sidebar.openNavigation")}
                >
                  <IconMenu2 className="h-4 w-4" />
                </button>
              </div>
            )}
            {!ownToolbar && <Header />}
            <InvitationBanner />
            <main
              className={cn(
                "agent-native-app-main min-h-0 flex-1",
                ownToolbar ? "overflow-hidden" : "overflow-y-auto",
              )}
            >
              {children}
            </main>
          </div>
          <AgentWorkIndicator />
        </div>
      </AgentSidebar>
    </HeaderActionsProvider>
  );
}
