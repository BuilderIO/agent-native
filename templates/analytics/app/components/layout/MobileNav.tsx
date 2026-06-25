import { useT } from "@agent-native/core/client";
import { IconMenu, IconChartBar } from "@tabler/icons-react";
import { useState, useEffect } from "react";
import { useLocation } from "react-router";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

import { Sidebar } from "./Sidebar";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const t = useT();

  // Auto-close on route change
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex h-12 shrink-0 items-center border-b border-border bg-sidebar px-4 md:hidden">
      <button
        onClick={() => setOpen(true)}
        className="me-3 p-2.5 -ms-1 rounded-md hover:bg-sidebar-accent/50"
        aria-label={t("navigation.openNavigation")}
      >
        <IconMenu className="h-5 w-5 text-foreground" />
      </button>
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <IconChartBar className="h-4 w-4" />
        </div>
        <span className="text-base font-bold tracking-tight">
          {t("navigation.brand")}
        </span>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="p-0 w-[280px]">
          <SheetTitle className="sr-only">
            {t("navigation.navigation")}
          </SheetTitle>
          <Sidebar mobile />
        </SheetContent>
      </Sheet>
    </div>
  );
}
