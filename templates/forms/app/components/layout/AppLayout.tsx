import { useState, useEffect } from "react";
import { useLocation } from "react-router";
import { IconMenu2 } from "@tabler/icons-react";
import { Sidebar } from "./Sidebar";
import { AgentSidebar } from "@agent-native/core/client";
import { InvitationBanner } from "@agent-native/core/client/org";
import { cn } from "@/lib/utils";

const BARE_ROUTES = new Set(["/form-preview"]);

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  if (BARE_ROUTES.has(location.pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 md:static md:z-auto",
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        <Sidebar />
      </div>
      <AgentSidebar
        position="right"
        defaultOpen
        emptyStateText="Ask me anything about your forms"
        suggestions={[
          "Create a contact form",
          "Show me form responses",
          "Add a rating field",
        ]}
      >
        <main className="flex-1 overflow-auto">
          <div className="flex h-12 items-center px-4 md:hidden border-b border-border">
            <button
              onClick={() => setSidebarOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground"
            >
              <IconMenu2 className="h-4 w-4" />
            </button>
          </div>
          <InvitationBanner />
          {children}
        </main>
      </AgentSidebar>
    </div>
  );
}
