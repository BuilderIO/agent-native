import { AgentSidebar } from "@agent-native/core/client";
import { IconInbox, IconRoute, IconTruckDelivery } from "@tabler/icons-react";
import { Link, useLocation } from "react-router";

import { cn } from "@/lib/utils";

const navItems = [
  { label: "Queue", href: "/queue", icon: IconInbox },
  { label: "Routing", href: "/routing-rules", icon: IconRoute },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <aside className="hidden w-16 shrink-0 border-r border-border bg-card md:flex md:flex-col md:items-center md:py-3">
        <div className="mb-5 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <IconTruckDelivery className="size-5" />
        </div>
        <nav className="flex flex-col gap-2">
          {navItems.map((item) => {
            const active =
              location.pathname === item.href ||
              (item.href === "/queue" &&
                location.pathname.startsWith("/work-items/"));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                to={item.href}
                title={item.label}
                className={cn(
                  "flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                  active && "bg-accent text-accent-foreground",
                )}
              >
                <Icon className="size-5" />
              </Link>
            );
          })}
        </nav>
      </aside>
      <AgentSidebar
        position="right"
        defaultOpen
        emptyStateText="Ask about the active queue, open work item, or routing context."
        suggestions={[
          "Summarize the open delivery work item",
          "Show blocked urgent work",
          "Assign this item to an owner",
        ]}
      >
        <main className="h-full flex-1 overflow-hidden">{children}</main>
      </AgentSidebar>
    </div>
  );
}
