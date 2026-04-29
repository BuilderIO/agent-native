import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { HeaderActionsProvider } from "./HeaderActions";
import { AgentSidebar } from "@agent-native/core/client";
import { InvitationBanner } from "@agent-native/core/client/org";
import { cn } from "@/lib/utils";

const BARE_ROUTES = new Set(["/form-preview"]);

// Routes whose page renders its own custom toolbar (with AgentToggleButton).
// Layout still mounts Sidebar + AgentSidebar, but skips its own Header so
// there's no double-header.
const NO_HEADER_PREFIXES = ["/forms/"];

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  if (BARE_ROUTES.has(location.pathname)) {
    return <>{children}</>;
  }

  // Editor routes (/forms/:id, /forms/:id/responses) render their own
  // toolbar with AgentToggleButton — skip the global Header to avoid
  // a double-header.
  const showHeader = !NO_HEADER_PREFIXES.some((prefix) =>
    location.pathname.startsWith(prefix),
  );

  return (
    <HeaderActionsProvider>
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
          <div className="flex h-full flex-1 flex-col overflow-hidden">
            {showHeader ? <Header /> : null}
            <InvitationBanner />
            <main className="flex-1 overflow-auto">{children}</main>
          </div>
        </AgentSidebar>
      </div>
    </HeaderActionsProvider>
  );
}
