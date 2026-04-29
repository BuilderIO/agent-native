import { useState, useEffect } from "react";
import { useLocation } from "react-router";
import { IconMenu2 } from "@tabler/icons-react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { HeaderActionsProvider } from "./HeaderActions";
import { AgentSidebar, AgentToggleButton } from "@agent-native/core/client";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

interface LayoutProps {
  children: React.ReactNode;
}

/**
 * Routes whose page renders its own h-12 toolbar (with title + AgentToggleButton).
 * Layout still wraps these with the left Sidebar and AgentSidebar but skips the
 * global Header so they don't double-stack a header bar.
 */
function routeOwnsToolbar(pathname: string): boolean {
  return pathname.startsWith("/tools");
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  const ownsToolbar = routeOwnsToolbar(location.pathname);

  return (
    <HeaderActionsProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        <div className="hidden md:block">
          <Sidebar />
        </div>
        <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
          <SheetContent side="left" className="p-0 w-[260px]">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Sidebar />
          </SheetContent>
        </Sheet>
        <AgentSidebar
          position="right"
          defaultOpen
          emptyStateText="How can I help?"
          suggestions={[
            "What can you do?",
            "Show me the database schema",
            "Create something cool",
          ]}
        >
          <div className="flex h-full flex-1 flex-col overflow-hidden">
            {/* Mobile-only top bar — gives a hamburger when no page toolbar is shown */}
            {ownsToolbar ? (
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
            ) : (
              <header className="flex h-12 items-center gap-3 border-b border-border bg-background px-4 lg:px-6 shrink-0">
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen(true)}
                  aria-label="Open navigation"
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent md:hidden"
                >
                  <IconMenu2 className="h-4 w-4" />
                </button>
                <div className="flex flex-1 min-w-0">
                  <Header />
                </div>
              </header>
            )}
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
        </AgentSidebar>
      </div>
    </HeaderActionsProvider>
  );
}

/**
 * Renders just the AgentToggleButton — exported so other custom toolbars
 * (none in starter today) could mount it consistently.
 */
export { AgentToggleButton };
