import { NavLink } from "react-router";
import {
  IconBrain,
  IconCircleCheck,
  IconCircleDashed,
} from "@tabler/icons-react";
import { FeedbackButton } from "@agent-native/core/client";
import { OrgSwitcher } from "@agent-native/core/client/org";
import { ExtensionsSidebarSection } from "@agent-native/core/client/extensions";
import { navItems } from "@/lib/brain";
import { cn } from "@/lib/utils";

const quickStats = [
  { label: "Indexed", value: "Ready" },
  { label: "Review", value: "Queued" },
  { label: "Sources", value: "Live" },
];

export function Sidebar() {
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
                className={({ isActive }) =>
                  cn(
                    "flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground",
                  )
                }
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            );
          })}
        </div>

        <div className="mt-5 rounded-md border border-sidebar-border bg-sidebar-accent/40 p-3">
          <div className="mb-3 flex items-center gap-2">
            <IconCircleCheck className="size-4 text-sidebar-foreground" />
            <span className="text-xs font-medium text-sidebar-accent-foreground">
              Memory ops
            </span>
          </div>
          <div className="grid gap-2">
            {quickStats.map((stat) => (
              <div
                key={stat.label}
                className="flex items-center justify-between gap-3 text-xs"
              >
                <span className="text-sidebar-foreground/70">{stat.label}</span>
                <span className="text-sidebar-accent-foreground">
                  {stat.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 rounded-md border border-sidebar-border bg-sidebar-accent/20 p-3">
          <div className="flex items-start gap-2">
            <IconCircleDashed className="mt-0.5 size-4 shrink-0 text-sidebar-foreground" />
            <p className="text-xs leading-5 text-sidebar-foreground/75">
              Ask uses cited company knowledge first. Review decides what
              becomes durable memory.
            </p>
          </div>
        </div>
      </nav>

      <div className="border-t border-sidebar-border px-2 py-2">
        <ExtensionsSidebarSection />
      </div>

      <div className="grid gap-2 border-t border-sidebar-border px-3 py-3">
        <FeedbackButton />
        <OrgSwitcher />
      </div>
    </aside>
  );
}
