import { Sidebar } from "./Sidebar";
import { AgentSidebar, AgentToggleButton } from "@agent-native/core/client";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <AgentSidebar
        position="left"
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
