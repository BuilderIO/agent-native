import { ReactNode } from "react";
import { DocumentSidebar } from "@/components/sidebar/DocumentSidebar";

interface AppLayoutProps {
  activeDocumentId: string | null;
  children: ReactNode;
}

export function AppLayout({ activeDocumentId, children }: AppLayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <DocumentSidebar activeDocumentId={activeDocumentId} />
      <main className="flex-1 flex flex-col min-w-0 relative">{children}</main>
    </div>
  );
}
