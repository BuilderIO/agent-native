import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { HeaderActionsProvider } from "./HeaderActions";
import { AgentSidebar } from "@agent-native/core/client";
import { useNavigationState } from "@/hooks/use-navigation-state";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  useNavigationState();
  return (
    <HeaderActionsProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        <div className="hidden md:block">
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
            <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
              {children}
            </main>
          </div>
        </AgentSidebar>
      </div>
    </HeaderActionsProvider>
  );
}
