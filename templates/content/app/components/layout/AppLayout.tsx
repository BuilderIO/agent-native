import { ReactNode, useState } from "react";
import { DocumentSidebar } from "@/components/sidebar/DocumentSidebar";
import { AgentSidebar } from "@agent-native/core/client";

interface AppLayoutProps {
  activeDocumentId: string | null;
  children: ReactNode;
}

export function AppLayout({ activeDocumentId, children }: AppLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <DocumentSidebar
        activeDocumentId={activeDocumentId}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
      />
      <AgentSidebar
        position="right"
        defaultOpen
        emptyStateText="Ask me anything about your documents"
        suggestions={[
          "Create a new page",
          "Search my documents",
          "Organize my pages",
        ]}
      >
        <main className="relative flex min-w-0 min-h-0 flex-1 flex-col">
          {children}
        </main>
      </AgentSidebar>
    </div>
  );
}
