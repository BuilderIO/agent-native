import { ReactNode } from "react";
import { DocumentSidebar } from "@/components/sidebar/DocumentSidebar";
import { AgentSidebar, AgentToggleButton } from "@agent-native/core/client";

interface AppLayoutProps {
  activeDocumentId: string | null;
  children: ReactNode;
}

export function AppLayout({ activeDocumentId, children }: AppLayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <div className="fixed right-3 top-3 z-50">
        <AgentToggleButton className="h-9 w-9 rounded-xl border border-border/60 bg-background/90 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/75" />
      </div>
      <DocumentSidebar activeDocumentId={activeDocumentId} />
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
        <main className="relative flex min-w-0 flex-1 flex-col">
          {children}
        </main>
      </AgentSidebar>
    </div>
  );
}
