import { AgentSidebar } from "@agent-native/core/client";
import { Header } from "./Header";
import { HeaderActionsProvider } from "./HeaderActions";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <HeaderActionsProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        <AgentSidebar position="right" defaultOpen>
          <div className="flex h-full flex-1 flex-col overflow-hidden">
            <Header />
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
        </AgentSidebar>
      </div>
    </HeaderActionsProvider>
  );
}
