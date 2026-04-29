import { useLocation } from "react-router";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { HeaderActionsProvider } from "./HeaderActions";
import { AgentSidebar } from "@agent-native/core/client";

interface LayoutProps {
  children: React.ReactNode;
}

const BARE_ROUTES = new Set<string>([]);

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  if (BARE_ROUTES.has(location.pathname)) {
    return <>{children}</>;
  }

  const isToolsRoute = location.pathname.startsWith("/tools/");

  return (
    <HeaderActionsProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        <Sidebar />
        <AgentSidebar
          position="right"
          defaultOpen
          emptyStateText="Ask me anything about your dictations"
          suggestions={[
            "Show my recent dictations",
            "Add a snippet for my email signature",
            "Make my work messages more formal",
          ]}
        >
          <div className="flex h-full flex-1 flex-col overflow-hidden">
            <Header />
            <main
              className={
                isToolsRoute
                  ? "flex-1 overflow-y-auto"
                  : "flex-1 overflow-y-auto"
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
