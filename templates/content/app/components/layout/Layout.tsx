import { ReactNode, useCallback, useState } from "react";
import { useLocation } from "react-router";
import { DocumentSidebar } from "@/components/sidebar/DocumentSidebar";
import { AgentSidebar } from "@agent-native/core/client";
import { InvitationBanner } from "@agent-native/core/client/org";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { IconMenu2 } from "@tabler/icons-react";
import { Header } from "./Header";
import { HeaderActionsProvider } from "./HeaderActions";

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_SIDEBAR_WIDTH = 240;
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 480;

// Routes whose page renders its own custom toolbar (with AgentToggleButton).
// Layout still mounts Sidebar + AgentSidebar, but skips its own Header so
// there's no double-header.
const NO_HEADER_PREFIXES = ["/page/", "/tools"];

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

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const activeDocumentId =
    location.pathname.match(/^\/page\/([^/]+)/)?.[1] ?? null;
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

  const showHeader = !NO_HEADER_PREFIXES.some((prefix) =>
    location.pathname.startsWith(prefix),
  );

  return (
    <HeaderActionsProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        {isMobile ? (
          <>
            <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
              <SheetContent
                side="left"
                showClose={false}
                className="w-[85vw] max-w-[85vw] sm:max-w-[85vw] p-0"
              >
                <DocumentSidebar
                  activeDocumentId={activeDocumentId}
                  collapsed={false}
                  onToggleCollapsed={() => setMobileSidebarOpen(false)}
                  onNavigate={() => setMobileSidebarOpen(false)}
                />
              </SheetContent>
            </Sheet>
            <button
              className="fixed top-3 left-3 z-30 flex h-10 w-10 items-center justify-center rounded-lg bg-background border border-border shadow-sm md:hidden cursor-pointer"
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
            {showHeader ? <Header /> : null}
            <InvitationBanner />
            {children}
          </main>
        </AgentSidebar>
      </div>
    </HeaderActionsProvider>
  );
}
