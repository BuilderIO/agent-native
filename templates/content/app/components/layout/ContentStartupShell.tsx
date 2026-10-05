import { AgentNativeIcon } from "@agent-native/toolkit/app/shared";
import { IconMenu2, IconSearch } from "@tabler/icons-react";

import { DocumentEditorSkeleton } from "@/components/editor/DocumentEditorSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { startupAnchor } from "@/lib/startup-timing";
import { cn } from "@/lib/utils";

import {
  DEFAULT_SIDEBAR_WIDTH,
  STARTUP_SIDEBAR_WIDTH_PROPERTY,
} from "./sidebar-preferences";
import { SidebarTriggerContext } from "./sidebar-trigger";

// The startup script marks <html> when the saved sidebar is collapsed.
const EXPANDED_ONLY = "[html[data-content-sidebar-collapsed]_&]:hidden";
const COLLAPSED_ONLY = "hidden [html[data-content-sidebar-collapsed]_&]:flex";
const SIDEBAR_SKELETON_CLASS_NAME =
  "rounded bg-sidebar-foreground/12 dark:bg-sidebar-foreground/10";

// Below the compact breakpoint the app drops the sidebar for a menu button.
const compactSidebarTrigger = (
  <div
    aria-hidden="true"
    className="hidden size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground max-[1100px]:flex"
  >
    <IconMenu2 size={18} />
  </div>
);

export function contentStartupShowsPage(pathname: string) {
  return pathname.startsWith("/page/") || pathname.startsWith("/home");
}

// What the server draws, and the app shows until the session is ready. Its
// sidebar rows, toolbar, and page title are the app's own boxes, so nothing
// moves when the app replaces them. It runs outside the app's providers.
export function ContentStartupShell({
  pathname,
  label,
}: {
  pathname: string;
  label: string;
}) {
  return (
    <div
      role="status"
      aria-label={label}
      className="agent-layout-shell flex h-screen overflow-hidden bg-background"
    >
      <div
        aria-hidden="true"
        className="agent-layout-left-drawer flex shrink-0 max-[1100px]:hidden"
      >
        <div
          className="agent-layout-left-drawer relative flex h-full min-h-0 flex-col border-e border-border bg-sidebar"
          style={{
            width: `var(${STARTUP_SIDEBAR_WIDTH_PROPERTY}, ${DEFAULT_SIDEBAR_WIDTH}px)`,
          }}
        >
          <div
            className={cn(
              "flex h-14 shrink-0 items-center gap-2 border-b border-border px-4",
              EXPANDED_ONLY,
            )}
          >
            <AgentNativeIcon className="h-3.5 w-6 shrink-0 text-primary" />
            <span className="truncate text-sm font-semibold text-primary">
              Content
            </span>
          </div>
          <div
            className={cn(
              "h-14 shrink-0 flex-col items-center justify-center border-b border-border px-2",
              COLLAPSED_ONLY,
            )}
          >
            <div className="flex size-8 items-center justify-center">
              <AgentNativeIcon className="h-3.5 w-6 shrink-0 text-primary" />
            </div>
          </div>
          <div
            {...startupAnchor("sidebar-space")}
            className={cn(
              "grid min-w-0 grid-cols-[minmax(0,1fr)_2rem] items-center gap-1 ps-3 pe-2 pt-2",
              EXPANDED_ONLY,
            )}
          >
            <div className="flex h-8 items-center ps-2">
              <Skeleton
                className={cn("h-3.5 w-24", SIDEBAR_SKELETON_CLASS_NAME)}
              />
            </div>
          </div>
          <div className={cn("shrink-0 ps-3 pe-2 py-2", EXPANDED_ONLY)}>
            <div
              {...startupAnchor("sidebar-search")}
              className="grid h-8 w-full grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center text-muted-foreground"
            >
              <IconSearch className="size-4 justify-self-center" />
              <Skeleton
                className={cn("ms-1.5 h-3.5 w-14", SIDEBAR_SKELETON_CLASS_NAME)}
              />
            </div>
          </div>
        </div>
      </div>
      <div className="agent-sidebar-shell flex min-w-0 flex-1 h-screen overflow-hidden">
        <div
          className="agent-sidebar-main-surface flex flex-1 flex-col overflow-auto min-w-0"
          data-agent-sidebar-main-position="right"
          data-agent-sidebar-main-state="closed"
        >
          <main className="agent-native-app-main relative flex min-w-0 min-h-0 flex-1 flex-col overflow-x-hidden">
            {contentStartupShowsPage(pathname) ? (
              <SidebarTriggerContext.Provider value={compactSidebarTrigger}>
                <DocumentEditorSkeleton iconRow="startup" shape="startup" />
              </SidebarTriggerContext.Provider>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}
