import { ReactNode } from "react";
import { DocumentSidebar } from "@/components/sidebar/DocumentSidebar";
import { AgentSidebar } from "@agent-native/core/client";

interface AppLayoutProps {
  activeDocumentId: string | null;
  children: ReactNode;
}

export function AppLayout({ activeDocumentId, children }: AppLayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <DocumentSidebar activeDocumentId={activeDocumentId} />
      <AgentSidebar
        position="left"
        defaultOpen
        emptyStateText="Ask me anything about your documents"
        suggestions={[
          "Create a new page",
          "Search my documents",
          "Organize my pages",
        ]}
      >
        <main className="flex-1 flex flex-col min-w-0 relative">
          {children}
        </main>
      </AgentSidebar>
    </div>
  );
}
