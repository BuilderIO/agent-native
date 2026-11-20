import { useT } from "@agent-native/core/client/i18n";
import { HeaderActionsProvider } from "@agent-native/toolkit/app-shell/header-actions";
import { AgentSidebar } from "@agent-native/toolkit/app/chat";
import { useCommandMenuShortcut } from "@agent-native/toolkit/app/shared";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router";

import { CommandMenu } from "@/components/command-menu/CommandMenu";
import { TrashDialog } from "@/components/trash/TrashDialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { TAB_ID } from "@/lib/tab-id";
import { cn } from "@/lib/utils";

import { Sidebar } from "./Sidebar";
import { OPEN_NAV_EVENT } from "./TopBar";

export function AppShell({ children }: { children: ReactNode }) {
  const t = useT();
  const { pathname } = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // Settings brings its own navigation and header, so it renders full width.
  // Not the toolkit's isSettingsPathname: it treats /forms/:id/settings as the app's Settings.
  const settingsOwnsChrome =
    pathname === "/settings" || pathname.startsWith("/settings/");
  useCommandMenuShortcut(useCallback(() => setSearchOpen(true), []));

  useEffect(() => setNavOpen(false), [pathname]);
  useEffect(() => {
    const open = () => setNavOpen(true);
    window.addEventListener(OPEN_NAV_EVENT, open);
    return () => window.removeEventListener(OPEN_NAV_EVENT, open);
  }, []);

  const openTrash = () => {
    setNavOpen(false);
    setTrashOpen(true);
  };

  return (
    <HeaderActionsProvider>
      <CommandMenu open={searchOpen} onOpenChange={setSearchOpen} />
      <TrashDialog open={trashOpen} onOpenChange={setTrashOpen} />
      <div className="flex min-h-screen w-full bg-background text-foreground">
        {settingsOwnsChrome ? null : (
          <>
            <div className="hidden md:fixed md:inset-y-0 md:left-0 md:z-10 md:block">
              <Sidebar onOpenTrash={openTrash} />
            </div>
            <Sheet open={navOpen} onOpenChange={setNavOpen}>
              <SheetContent
                side="left"
                className="w-[var(--forms-sidebar-width)] p-0"
              >
                <SheetTitle className="sr-only">
                  {t("forms.shell.navigation")}
                </SheetTitle>
                <SheetDescription className="sr-only">
                  {t("forms.shell.navigationDescription")}
                </SheetDescription>
                <Sidebar onOpenTrash={openTrash} />
              </SheetContent>
            </Sheet>
          </>
        )}
        <AgentSidebar
          position="right"
          storageKey="forms"
          browserTabId={TAB_ID}
          agentPageHref="/settings/agent"
          emptyStateText={t("forms.shell.agentEmptyState")}
          suggestions={[
            t("forms.shell.agentSuggestionCreate"),
            t("forms.shell.agentSuggestionTop"),
          ]}
        >
          <main
            className={cn(
              "agent-native-app-main flex min-h-screen min-w-0 flex-1 flex-col",
              !settingsOwnsChrome && "md:pl-[var(--forms-sidebar-width)]",
            )}
          >
            {children}
          </main>
        </AgentSidebar>
      </div>
    </HeaderActionsProvider>
  );
}
