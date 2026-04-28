import { ReactNode, useState, useEffect } from "react";
import { useLocation } from "react-router";
import { AgentSidebar, AgentToggleButton } from "@agent-native/core/client";
import { IconMenu2 } from "@tabler/icons-react";
import { LibrarySidebar } from "./library-sidebar";
import { CallSearchBar } from "./call-search-bar";
import { cn } from "@/lib/utils";

interface LibraryLayoutProps {
  children: ReactNode;
}

export function LibraryLayout({ children }: LibraryLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AgentSidebar
        position="right"
        emptyStateText="How can I help with your calls?"
        suggestions={[
          "Summarize the call I just reviewed",
          "Find the moment someone objected to pricing",
          "Create a tracker for competitor mentions",
          "Invite bob@example.com to this workspace",
        ]}
      >
        <div className="flex h-full w-full">
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
            <LibrarySidebar />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex items-center gap-3 border-b border-border px-5 py-2">
              <button
                onClick={() => setSidebarOpen(true)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground md:hidden"
              >
                <IconMenu2 className="h-4 w-4" />
              </button>
              <CallSearchBar />
              <div className="ml-auto flex items-center gap-2">
                <AgentToggleButton />
              </div>
            </header>
            <main className="flex flex-1 flex-col min-h-0 overflow-hidden">
              {children}
            </main>
          </div>
        </div>
      </AgentSidebar>
    </div>
  );
}
