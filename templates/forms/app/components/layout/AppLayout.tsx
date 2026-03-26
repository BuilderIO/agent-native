import { Sidebar } from "./Sidebar";
import { AgentSidebar, AgentToggleButton } from "@agent-native/core/client";
import { ThemeToggle } from "@/components/ThemeToggle";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <div className="fixed right-3 top-3 z-50">
        <AgentToggleButton className="h-9 w-9 rounded-xl border border-border/60 bg-background/90 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/75" />
      </div>
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
