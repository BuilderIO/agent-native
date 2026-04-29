import { useState, useEffect } from "react";
import { useLocation } from "react-router";
import { IconMenu2 } from "@tabler/icons-react";
import { NavSidebar } from "./NavSidebar";
import { Header } from "./Header";
import { HeaderActionsProvider } from "./HeaderActions";
import { AgentSidebar } from "@agent-native/core/client";
import { InvitationBanner } from "@agent-native/core/client/org";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

interface LayoutProps {
  children: React.ReactNode;
}

/**
 * Routes whose page renders its own h-12 toolbar (with title + AgentToggleButton).
 * Layout still wraps these with the AgentSidebar but skips the global Header
 * and the left NavSidebar so they don't double-stack chrome.
 *
 * - Studio routes (`/`, `/c/:id`) render their own complex sidebar + StudioHeader
 *   inside `pages/Index.tsx`.
 * - Tools routes (`/tools`, `/tools/:id`) render the framework's tools toolbar.
 */
function studioRoute(pathname: string): boolean {
  if (pathname === "/") return true;
  if (pathname.startsWith("/c/")) return true;
  return false;
}

function routeOwnsToolbar(pathname: string): boolean {
  if (studioRoute(pathname)) return true;
  if (pathname.startsWith("/tools")) return true;
  if (pathname.startsWith("/components")) return true;
  return false;
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  const isStudio = studioRoute(location.pathname);
  const ownsToolbar = routeOwnsToolbar(location.pathname);

  // Studio routes own their entire chrome (header + sidebar + agent sidebar
  // are mounted inside pages/Index.tsx so AgentToggleButton can sit in the
  // StudioHeader). Render the page directly.
  if (isStudio) {
    return <HeaderActionsProvider>{children}</HeaderActionsProvider>;
  }

  return (
    <HeaderActionsProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        <div className="hidden md:block">
          <NavSidebar />
        </div>
        <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
          <SheetContent side="left" className="p-0 w-[260px]">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <NavSidebar />
          </SheetContent>
        </Sheet>
        <AgentSidebar
          position="right"
          defaultOpen
          emptyStateText="Ask me anything about your videos"
          suggestions={[
            "Create a new composition",
            "Add a camera pan effect",
            "Adjust the animation timing",
          ]}
        >
          <div className="flex h-full flex-1 flex-col overflow-hidden">
            {ownsToolbar ? (
              <div className="flex h-12 items-center border-b border-border px-4 md:hidden shrink-0">
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen(true)}
                  aria-label="Open navigation"
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
                >
                  <IconMenu2 className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <Header onOpenMobileSidebar={() => setMobileSidebarOpen(true)} />
            )}
            <InvitationBanner />
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
        </AgentSidebar>
      </div>
    </HeaderActionsProvider>
  );
}
