import { NavLink } from "react-router";
import { IconBrain, IconSettings } from "@tabler/icons-react";
import { FeedbackButton } from "@agent-native/core/client";
import { OrgSwitcher } from "@agent-native/core/client/org";
import { navItems } from "@/lib/brain";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const navClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors",
      isActive
        ? "bg-sidebar-accent text-sidebar-accent-foreground"
        : "text-sidebar-foreground hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground",
    );

  return (
    <aside className="flex h-full w-60 min-w-0 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-sidebar-border px-4">
        <div className="flex size-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
          <IconBrain className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-sidebar-accent-foreground">
            Brain
          </p>
          <p className="truncate text-xs text-sidebar-foreground/70">
            Company memory
          </p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="grid gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.href}
                to={item.href}
                end={item.href === "/"}
                className={navClass}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>

      <div className="grid gap-2 border-t border-sidebar-border px-3 py-3">
        <NavLink to="/settings" className={navClass}>
          <IconSettings className="size-4 shrink-0" />
          <span className="truncate">Settings</span>
        </NavLink>
        <FeedbackButton />
        <OrgSwitcher />
      </div>
    </aside>
  );
}
