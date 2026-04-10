import { ReactNode, useCallback, useState } from "react";
import { DocumentSidebar } from "@/components/sidebar/DocumentSidebar";
import { AgentSidebar } from "@agent-native/core/client";
import { InvitationBanner } from "@agent-native/core/client/org";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { IconMenu2 } from "@tabler/icons-react";

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_SIDEBAR_WIDTH = 240;
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 480;

function loadSidebarWidth(): number {
  try {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (stored) {
      const w = Number(stored);
      if (w >= MIN_SIDEBAR_WIDTH && w <= MAX_SIDEBAR_WIDTH) return w;
    }
  } catch {}
  return DEFAULT_SIDEBAR_WIDTH;
}

interface AppLayoutProps {
  activeDocumentId: string | null;
  children: ReactNode;
}

export function AppLayout({ activeDocumentId, children }: AppLayoutProps) {
  const isMobile = useIsMobile();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);

  const handleSidebarResize = useCallback((width: number) => {
    const clamped = Math.max(
      MIN_SIDEBAR_WIDTH,
      Math.min(MAX_SIDEBAR_WIDTH, width),
    );
    setSidebarWidth(clamped);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clamped));
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {isMobile ? (
        <>
          <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
            <SheetContent side="left" className="w-72 p-0">
              <DocumentSidebar
                activeDocumentId={activeDocumentId}
                collapsed={false}
                onToggleCollapsed={() => setMobileSidebarOpen(false)}
                onNavigate={() => setMobileSidebarOpen(false)}
              />
            </SheetContent>
          </Sheet>
          <button
            className="fixed top-3 left-3 z-30 flex h-10 w-10 items-center justify-center rounded-lg bg-background border border-border shadow-sm md:hidden"
            onClick={() => setMobileSidebarOpen(true)}
          >
            <IconMenu2 size={18} />
          </button>
        </>
      ) : (
        <DocumentSidebar
          activeDocumentId={activeDocumentId}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
          width={sidebarWidth}
          onResize={handleSidebarResize}
        />
      )}
      <AgentSidebar
        position="right"
        defaultOpen={!isMobile}
        emptyStateText="Ask me anything about your documents"
        suggestions={[
          "Create a new page",
          "Search my documents",
          "Organize my pages",
        ]}
      >
        <main className="relative flex min-w-0 min-h-0 flex-1 flex-col">
          <InvitationBanner />
          {children}
        </main>
      </AgentSidebar>
    </div>
  );
}
