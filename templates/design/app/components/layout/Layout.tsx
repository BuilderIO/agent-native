import { useState, useEffect } from "react";
import { useLocation } from "react-router";
import { IconMenu2 } from "@tabler/icons-react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { HeaderActionsProvider } from "./HeaderActions";
import { AgentSidebar } from "@agent-native/core/client";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { cn } from "@/lib/utils";

interface LayoutProps {
  children: React.ReactNode;
}

/** Routes that render with no app shell at all (no sidebar, no header). */
const BARE_PREFIXES = ["/present/"];

/**
 * Routes where the page renders its own toolbar instead of the global Header.
 * The Sidebar + AgentSidebar still render. The Header is hidden so the page
 * can supply a richer custom toolbar (e.g. DesignEditor mode/zoom/device,
 * shared ExtensionViewer / ExtensionsListPage chrome).
 */
const EDITOR_PREFIXES = ["/design/", "/extensions"];

export function Layout({ children }: LayoutProps) {
  useNavigationState();
  const location = useLocation();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  const isBare = BARE_PREFIXES.some((p) => location.pathname.startsWith(p));
  if (isBare) {
    return <>{children}</>;
  }

  const hideHeader = EDITOR_PREFIXES.some((p) =>
    location.pathname.startsWith(p),
  );

  return (
    <HeaderActionsProvider>
      <AgentSidebar
        position="right"
        emptyStateText="Describe a design to create"
        suggestions={[
          "Create a todo app prototype",
          "Design a landing page for my startup",
          "Build a dashboard with charts",
        ]}
      >
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
          <div className="flex h-full flex-1 flex-col overflow-hidden">
            {/* Mobile-only top bar with hamburger */}
            <div className="flex items-center h-12 border-b border-border px-4 md:hidden bg-sidebar shrink-0">
              <button
                onClick={() => setMobileSidebarOpen(true)}
                className="-ml-1 mr-3 p-2.5 rounded-md hover:bg-sidebar-accent/50 cursor-pointer"
                aria-label="Open navigation"
              >
                <IconMenu2 className="h-5 w-5 text-foreground" />
              </button>
              <span className="text-base font-bold tracking-tight">Design</span>
            </div>
            {!hideHeader && <Header />}
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
        </div>
      </AgentSidebar>
    </HeaderActionsProvider>
  );
}
