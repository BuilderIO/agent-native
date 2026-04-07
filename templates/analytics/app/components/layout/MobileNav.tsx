import { useState, useEffect } from "react";
import { useLocation } from "react-router";
import { IconMenu, IconChartBar } from "@tabler/icons-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Sidebar } from "./Sidebar";
import { AgentToggleButton } from "@agent-native/core/client";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Auto-close on route change
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex items-center h-14 border-b border-border px-4 md:hidden bg-sidebar">
      <button
        onClick={() => setOpen(true)}
        className="mr-3 p-2.5 -ml-1 rounded-md hover:bg-sidebar-accent/50"
        aria-label="Open navigation"
      >
        <IconMenu className="h-5 w-5 text-foreground" />
      </button>
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <IconChartBar className="h-4 w-4" />
        </div>
        <span className="text-base font-bold tracking-tight">Analytics</span>
      </div>
      <div className="ml-auto">
        <AgentToggleButton />
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="p-0 w-[280px]">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar mobile />
        </SheetContent>
      </Sheet>
    </div>
  );
}
