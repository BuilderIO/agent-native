import { FeedbackButton, appPath } from "@agent-native/core/client";
import { ExtensionsSidebarSection } from "@agent-native/core/client/extensions";
import { OrgSwitcher } from "@agent-native/core/client/org";

export function Sidebar() {
  return (
    <aside className="hidden md:flex w-64 min-w-0 shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-12 shrink-0 items-center border-b border-border px-4">
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
      <div className="space-y-2 border-t border-border px-3 py-2">
        <FeedbackButton />
        <OrgSwitcher />
      </div>
    </aside>
  );
}
