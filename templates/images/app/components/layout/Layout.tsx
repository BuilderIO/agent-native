import { useState, useEffect } from "react";
import { useLocation } from "react-router";
import { IconMenu2 } from "@tabler/icons-react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { HeaderActionsProvider } from "./HeaderActions";
import { AgentSidebar } from "@agent-native/core/client";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { cn } from "@/lib/utils";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  useNavigationState();
  const location = useLocation();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  const hideHeader =
    location.pathname === "/extensions" ||
    location.pathname.startsWith("/extensions/");

  return (
    <HeaderActionsProvider>
      <AgentSidebar
        position="right"
        emptyStateText="Describe the image you want to make"
        suggestions={[
          "Generate 3 blog hero directions from this library",
          "Make this candidate darker and more editorial",
          "Create product imagery that matches my references",
        ]}
      >
        <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
          {mobileSidebarOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/50 md:hidden"
              onClick={() => setMobileSidebarOpen(false)}
            />
          )}
          <div
            className={cn(
              "fixed inset-y-0 left-0 z-50 md:static md:z-auto",
              mobileSidebarOpen
                ? "translate-x-0"
                : "-translate-x-full md:translate-x-0",
            )}
          >
            <Sidebar />
          </div>
          <div className="flex h-full flex-1 flex-col overflow-hidden">
            {/* Mobile-only top bar with hamburger */}
            <div className="flex items-center h-12 border-b border-border px-4 md:hidden bg-sidebar shrink-0">
              <button
                onClick={() => setMobileSidebarOpen(true)}
                className="-ml-1 mr-3 p-2.5 rounded-md hover:bg-sidebar-accent/50 cursor-pointer"
                aria-label="Open navigation"
              >
                <IconMenu2 className="h-5 w-5 text-foreground" />
              </button>
              <span className="text-base font-bold tracking-tight">Images</span>
            </div>
            {!hideHeader && <Header />}
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
        </div>
      </AgentSidebar>
    </HeaderActionsProvider>
  );
}
