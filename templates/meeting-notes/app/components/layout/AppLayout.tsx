import { AgentSidebar } from "@agent-native/core/client";
import { RequireActiveOrg } from "@agent-native/core/client/org";
import { Header } from "./Header";
import { HeaderActionsProvider } from "./HeaderActions";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <HeaderActionsProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        <AgentSidebar
          position="right"
          defaultOpen
          emptyStateText="Ask me anything about your meetings"
          suggestions={[
            "Enhance my notes for this meeting",
            "What action items came out of today?",
            "Find decisions we made about pricing",
          ]}
        >
          <div className="flex h-full flex-1 flex-col overflow-hidden">
            <Header />
            <main className="flex-1 overflow-y-auto">
              <RequireActiveOrg
                title="Create your Notes workspace"
                description="Notes keeps meetings, templates, and contacts scoped to your organization. Create one to start capturing meeting notes."
              >
                {children}
              </RequireActiveOrg>
            </main>
          </div>
        </AgentSidebar>
      </div>
    </HeaderActionsProvider>
  );
}
