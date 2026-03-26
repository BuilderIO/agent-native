import { Sidebar } from "./Sidebar";
import { AgentSidebar } from "@agent-native/core/client";
import { ThemeToggle } from "@/components/ThemeToggle";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <div className="relative flex h-full">
        <Sidebar />
        <div className="absolute bottom-3 right-3">
          <ThemeToggle />
        </div>
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
        <main className="flex-1 overflow-auto">{children}</main>
      </AgentSidebar>
    </div>
  );
}
