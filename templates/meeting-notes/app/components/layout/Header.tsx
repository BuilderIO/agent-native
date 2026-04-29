import { useState } from "react";
import { useLocation } from "react-router";
import { IconMenu2, IconX } from "@tabler/icons-react";
import { ToolsSidebarSection } from "@agent-native/core/client/tools";
import { AgentToggleButton } from "@agent-native/core/client";
import { useHeaderTitle, useHeaderActions } from "./HeaderActions";

const pageTitles: Record<string, string> = {
  "/": "Notes",
  "/tools": "Tools",
};

function resolveTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  if (pathname.startsWith("/tools")) return "Tools";
  return "Notes";
}

export function Header() {
  const location = useLocation();
  const title = useHeaderTitle();
  const actions = useHeaderActions();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
      <button
        onClick={() => setMenuOpen(true)}
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Open menu"
      >
        <IconMenu2 className="h-4 w-4" />
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {title ?? (
          <span className="truncate text-sm font-semibold text-foreground">
            {resolveTitle(location.pathname)}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {actions}
        <AgentToggleButton className="h-8 w-8 rounded-md hover:bg-accent" />
      </div>

      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setMenuOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 w-64 overflow-y-auto border-r border-border bg-background shadow-xl">
            <div className="flex h-12 items-center justify-between border-b border-border px-4">
              <span className="text-sm font-semibold text-foreground">
                Meeting Notes
              </span>
              <button
                onClick={() => setMenuOpen(false)}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Close menu"
              >
                <IconX className="h-4 w-4" />
              </button>
            </div>
            <div className="p-3">
              <ToolsSidebarSection />
            </div>
          </div>
        </>
      )}
    </header>
  );
}
