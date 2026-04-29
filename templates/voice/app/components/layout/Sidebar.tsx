import { ToolsSidebarSection } from "@agent-native/core/client/tools";

export function Sidebar() {
  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
      <div className="border-b px-4 py-3">
        <span className="text-sm font-semibold text-foreground">Voice</span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-3">
        <ToolsSidebarSection />
      </div>
    </aside>
  );
}
