import { Link, useLocation } from "react-router";
import { IconArrowRight, IconDatabase, IconRoute } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { ExtensionsSidebarSection } from "@agent-native/core/client/extensions";
import { FeedbackButton, appPath } from "@agent-native/core/client";
import { OrgSwitcher } from "@agent-native/core/client/org";

const navItems = [{ icon: IconRoute, label: "Workbench", href: "/" }];

export function Sidebar() {
  const location = useLocation();

  return (
    <aside className="flex h-full w-56 min-w-0 shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-12 shrink-0 items-center gap-2 px-4 border-b border-border">
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
        <span className="text-sm font-semibold tracking-tight">Migration</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === "/"
              ? location.pathname === "/"
              : location.pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border px-3 py-3">
        <div className="space-y-2 rounded-lg border border-border/60 bg-background/60 p-3">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <IconDatabase className="h-3.5 w-3.5" />
            SQL audit trail
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <IconArrowRight className="h-3.5 w-3.5" />
            Verified output
          </div>
        </div>
      </div>

      <div className="mt-auto shrink-0">
        <div className="border-t border-border px-2 py-1">
          <ExtensionsSidebarSection />
        </div>

        <div className="border-t border-border px-3 py-2">
          <OrgSwitcher />
        </div>

        <div className="border-t border-border px-3 py-2">
          <FeedbackButton />
        </div>
      </div>
    </aside>
  );
}
