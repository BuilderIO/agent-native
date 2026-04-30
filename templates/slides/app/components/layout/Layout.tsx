import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { HeaderActionsProvider } from "./HeaderActions";
import { AgentSidebar } from "@agent-native/core/client";
import { InvitationBanner } from "@agent-native/core/client/org";
import { IconMenu2 } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";

interface LayoutProps {
  children: React.ReactNode;
}

/** Routes whose pages render their own toolbar — Layout still renders chrome
 * (sidebar + AgentSidebar wrapper) but skips its own Header. */
function pageHasOwnToolbar(pathname: string): boolean {
  if (pathname.startsWith("/deck/")) return true;
  // /tools (list) and /tools/<id> (viewer) both render their own headers
  // from @agent-native/core/client/tools.
  if (pathname === "/tools" || pathname.startsWith("/tools/")) return true;
  return false;
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { collapsed: sidebarCollapsed, setCollapsed: setSidebarCollapsed } =
    useSidebarCollapsed();

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
        emptyStateText="Ask me anything about your presentations"
        suggestions={[
          "Create a new deck",
          "Generate slides about AI",
          "Add an image to this slide",
        ]}
      >
        <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
          {sidebarOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/50 md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}
          <div
            className={cn(
              "fixed inset-y-0 left-0 z-50 md:static md:z-auto",
              sidebarOpen
                ? "translate-x-0"
                : "-translate-x-full md:translate-x-0",
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
          <div className="flex h-full flex-1 flex-col overflow-hidden">
            {/* Mobile-only nav strip with hamburger — only when there's no page toolbar */}
            {!ownToolbar && (
              <div className="flex h-12 items-center border-b border-border px-4 md:hidden shrink-0">
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground cursor-pointer"
                  aria-label="Open navigation"
                >
                  <IconMenu2 className="h-4 w-4" />
                </button>
              </div>
            )}
            {!ownToolbar && <Header />}
            <InvitationBanner />
            {children}
          </div>
        </div>
      </AgentSidebar>
    </HeaderActionsProvider>
  );
}
