import { useState } from "react";
import { IconMenu2, IconX } from "@tabler/icons-react";
import { ToolsSidebarSection } from "@agent-native/core/client/tools";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="relative flex h-screen flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center border-b border-border px-3">
        <button
          onClick={() => setMenuOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Open menu"
        >
          <IconMenu2 className="h-4 w-4" />
        </button>
        <span className="ml-2 text-sm font-semibold text-foreground">
          Meeting Notes
        </span>
      </header>

      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setMenuOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 w-64 bg-background border-r border-border shadow-xl overflow-y-auto">
            <div className="flex h-12 items-center justify-between border-b border-border px-4">
              <span className="text-sm font-semibold text-foreground">
                Meeting Notes
              </span>
              <button
                onClick={() => setMenuOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
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

      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
