import { useState, useEffect } from "react";
import { useLocation } from "react-router";
import { IconMenu2 } from "@tabler/icons-react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { HeaderActionsProvider } from "./HeaderActions";
import { AgentSidebar } from "@agent-native/core/client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";

interface LayoutProps {
  children: React.ReactNode;
}

/**
 * Routes whose page renders its own h-12 toolbar (with title + AgentToggleButton).
 * Layout still wraps these with the left Sidebar and AgentSidebar but skips the
 * global Header so they don't double-stack a header bar.
 */
function routeOwnsToolbar(pathname: string): boolean {
  return pathname.startsWith("/extensions") || pathname.startsWith("/plans");
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem("plans.sidebarCollapsed.v2");
    return stored ? stored === "true" : true;
  });

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    window.localStorage.setItem(
      "plans.sidebarCollapsed.v2",
      String(sidebarCollapsed),
    );
  }, [sidebarCollapsed]);

  const ownsToolbar = routeOwnsToolbar(location.pathname);

  return (
    <HeaderActionsProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        <div className="hidden md:block">
          <Sidebar
            collapsed={sidebarCollapsed}
            onCollapsedChange={setSidebarCollapsed}
          />
        </div>
        <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
          <SheetContent side="left" className="p-0 w-[260px]">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">
              App navigation links
            </SheetDescription>
            <Sidebar collapsed={false} collapsible={false} />
          </SheetContent>
        </Sheet>
        <AgentSidebar
          position="right"
          defaultOpen={false}
          emptyStateText="Ask the Plans agent to revise this HTML plan, apply comments, add diagrams, or patch the document in place."
          suggestions={[
            "Patch this plan based on the open comments",
            "Add a concrete diagram and higher-fidelity wireframe",
            "Turn this Markdown plan into a richer HTML plan",
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
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
        </AgentSidebar>
      </div>
    </HeaderActionsProvider>
  );
}
