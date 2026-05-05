import { useLocation } from "react-router";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { Header } from "./Header";
import { HeaderActionsProvider } from "./HeaderActions";
import { AgentSidebar } from "@agent-native/core/client";
import { InvitationBanner } from "@agent-native/core/client/org";
import { useNavigationState } from "@/hooks/use-navigation-state";

interface LayoutProps {
  children: React.ReactNode;
}

const BARE_ROUTES = new Set(["/chart"]);

export function Layout({ children }: LayoutProps) {
  useNavigationState();
  const location = useLocation();
  if (BARE_ROUTES.has(location.pathname)) {
    return <>{children}</>;
  }
  // Extensions list (`/extensions`) and viewer (`/extensions/:id`) render their own h-12
  // toolbar with NotificationsBell + AgentToggleButton. Skip the framework
  // Header so there's no double-header.
  const isExtensionsRoute =
    location.pathname === "/extensions" ||
    location.pathname.startsWith("/extensions/");
  return (
    <HeaderActionsProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        <div className="hidden shrink-0 md:block">
          <Sidebar />
        </div>
        <AgentSidebar
          position="right"
          defaultOpen
          emptyStateText="Ask me anything about your data"
          suggestions={[
            "Show weekly signup trends",
            "Query top pages by traffic",
            "Check error rates",
          ]}
        >
          <div className="flex h-full flex-1 flex-col overflow-hidden">
            <MobileNav />
            {!isExtensionsRoute && <Header />}
            <InvitationBanner />
            <main
              className={
                isExtensionsRoute
                  ? "flex-1 overflow-y-auto"
                  : "flex-1 overflow-y-auto p-4 md:p-6 lg:p-8"
              }
            >
              {children}
            </main>
          </div>
        </AgentSidebar>
      </div>
    </HeaderActionsProvider>
  );
}
