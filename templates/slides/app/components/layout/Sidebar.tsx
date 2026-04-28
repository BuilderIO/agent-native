import { Link, useLocation } from "react-router";
import { IconStack2, IconPalette, IconUsers } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { ToolsSidebarSection } from "@agent-native/core/client/tools";
import { FeedbackButton } from "@agent-native/core/client";

const navItems = [
  { icon: IconStack2, label: "Decks", href: "/" },
  { icon: IconPalette, label: "Design Systems", href: "/design-systems" },
  { icon: IconUsers, label: "Team", href: "/team" },
];

export function Sidebar() {
  const location = useLocation();

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-12 items-center px-4 border-b border-border">
        <span className="text-sm font-semibold tracking-tight">Slides</span>
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

      <div className="border-t border-border px-2 py-2">
        <ToolsSidebarSection />
      </div>

      <div className="border-t border-border px-3 py-2">
        <FeedbackButton />
      </div>
    </aside>
  );
}
