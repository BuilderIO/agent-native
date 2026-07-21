import { Button } from "@agent-native/toolkit/ui/button";
import {
  IconBuilding,
  IconChecklist,
  IconLayoutDashboard,
  IconMessageCircle,
  IconPencilCheck,
  IconRoute,
  IconSettings,
  IconUsers,
  IconViewfinder,
} from "@tabler/icons-react";
import { Link, NavLink } from "react-router";

import { cn } from "@/lib/utils";

const navigation = [
  { to: "/", label: "My work", icon: IconLayoutDashboard, end: true },
  { to: "/accounts", label: "Accounts", icon: IconBuilding },
  { to: "/people", label: "People", icon: IconUsers },
  { to: "/opportunities", label: "Opportunities", icon: IconRoute },
  { to: "/tasks", label: "Tasks", icon: IconChecklist },
  { to: "/proposals", label: "Proposals", icon: IconPencilCheck },
  { to: "/views", label: "Saved views", icon: IconViewfinder },
];

export function CrmSidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex h-full w-56 flex-col border-r border-sidebar-border bg-sidebar px-2 py-3 text-sidebar-foreground">
      <div className="flex h-8 items-center px-2 text-sm font-semibold tracking-tight text-sidebar-primary">
        CRM
      </div>
      <div className="mt-4 grid gap-0.5">
        {navigation.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "flex h-8 items-center gap-2 rounded-md px-2 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  isActive &&
                    "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                )
              }
            >
              <Icon className="size-4" />
              {item.label}
            </NavLink>
          );
        })}
      </div>
      <div className="mt-auto grid gap-1 border-t border-sidebar-border pt-3">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <NavLink to="/ask" onClick={onNavigate}>
            <IconMessageCircle className="size-4" />
            Ask CRM
          </NavLink>
        </Button>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <Link to="/settings#connections" onClick={onNavigate}>
            <IconSettings className="size-4" />
            Connections
          </Link>
        </Button>
      </div>
    </nav>
  );
}
