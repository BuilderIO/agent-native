import { useT } from "@agent-native/core/client";
import { IconMenu, IconPlus } from "@tabler/icons-react";
import { useState, useEffect } from "react";
import { useLocation } from "react-router";

import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

import { Sidebar } from "./Sidebar";

export function MobileNav({ showNewChat }: { showNewChat?: boolean }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const t = useT();

  // Auto-close on route change
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  return (
    <div className="analytics-mobile-nav flex h-11 shrink-0 items-center border-b border-border bg-background px-3 md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            className="-ms-1 me-2 flex size-9 items-center justify-center rounded-md hover:bg-sidebar-accent/50"
            aria-label={t("navigation.openNavigation")}
          >
            <IconMenu className="h-5 w-5 text-foreground" />
          </button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 w-[280px]">
          <SheetTitle className="sr-only">
            {t("navigation.navigation")}
          </SheetTitle>
          <Sidebar mobile />
        </SheetContent>
      </Sheet>

      <span className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">
        {t("navigation.brand")}
      </span>

      {showNewChat ? (
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("agent-chat:new-chat"))}
          className="ms-2 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("chat.newChat")}
        >
          <IconPlus className="h-4 w-4" />
          <span>{t("chat.newChat")}</span>
        </button>
      ) : null}
    </div>
  );
}
