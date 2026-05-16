import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { AgentSidebar } from "@agent-native/core/client";
import { IconMenu2 } from "@tabler/icons-react";
import { Sidebar } from "@/components/layout/Sidebar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const isAskRoute = location.pathname === "/";

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  const sidebarFrame = (
    <>
      <div className="hidden md:block">
        <Sidebar />
      </div>
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="w-[min(18rem,88vw)] p-0">
          <SheetTitle className="sr-only">Brain navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Navigate between Brain work surfaces.
          </SheetDescription>
          <Sidebar />
        </SheetContent>
      </Sheet>
    </>
  );

  const contentFrame = (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-3 md:hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setMobileSidebarOpen(true)}
          aria-label="Open navigation"
        >
          <IconMenu2 className="size-4" />
        </Button>
        <span className="text-sm font-semibold">Brain</span>
      </div>
      <main className="min-w-0 flex-1 overflow-y-auto overscroll-contain">
        {children}
      </main>
    </div>
  );

  if (isAskRoute) {
    return (
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        {sidebarFrame}
        {contentFrame}
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {sidebarFrame}
      <AgentSidebar
        position="right"
        emptyStateText="Ask Brain about the company."
        suggestions={[
          "What do we tell enterprise prospects about security?",
          "Find stale onboarding facts that need review.",
          "Which sources have sync problems?",
        ]}
      >
        {contentFrame}
      </AgentSidebar>
    </div>
  );
}
