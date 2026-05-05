import { appPath } from "@agent-native/core/client";
import { ExtensionsSidebarSection } from "@agent-native/core/client/extensions";

export function Sidebar() {
  return (
    <aside className="hidden md:flex w-64 min-w-0 shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar text-sidebar-foreground">
      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <img
            src={appPath("/agent-native-icon-light.svg")}
            alt=""
            aria-hidden="true"
            className="block h-4 w-auto dark:hidden"
          />
          <img
            src={appPath("/agent-native-icon-dark.svg")}
            alt=""
            aria-hidden="true"
            className="hidden h-4 w-auto dark:block"
          />
          <span className="text-sm font-semibold text-foreground">Voice</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-3">
        <ExtensionsSidebarSection />
      </div>
    </aside>
  );
}
