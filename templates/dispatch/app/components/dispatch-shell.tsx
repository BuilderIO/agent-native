import { useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router";
import {
  AgentSidebar,
  AgentToggleButton,
  FeedbackButton,
} from "@agent-native/core/client";
import { InvitationBanner } from "@agent-native/core/client/org";
import { ToolsSidebarSection } from "@agent-native/core/client/tools";
import {
  IconArrowUpRight,
  IconBellCog,
  IconBrandTelegram,
  IconKey,
  IconLayersSubtract,
  IconPlugConnected,
  IconBroadcast,
  IconFingerprint,
  IconHistory,
  IconLayoutSidebar,
  IconPuzzle,
  IconShieldCheck,
  IconUsersGroup,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

const NAV_ITEMS = [
  { to: "/overview", label: "Overview", icon: IconBroadcast },
  { to: "/vault", label: "Vault", icon: IconKey },
  { to: "/integrations", label: "Integrations", icon: IconPuzzle },
  { to: "/workspace", label: "Resources", icon: IconLayersSubtract },
  { to: "/messaging", label: "Messaging", icon: IconBrandTelegram },
  { to: "/agents", label: "Agents", icon: IconPlugConnected },
  { to: "/destinations", label: "Destinations", icon: IconArrowUpRight },
  { to: "/identities", label: "Identities", icon: IconFingerprint },
  { to: "/approvals", label: "Approvals", icon: IconShieldCheck },
  { to: "/audit", label: "Audit", icon: IconHistory },
  { to: "/team", label: "Team", icon: IconUsersGroup },
] as const;

const SIDEBAR_SUGGESTIONS = [
  "Add a Google OAuth secret to the vault",
  "What integrations does the analytics app need?",
  "Grant ANTHROPIC_API_KEY to the mail app",
  "List the connected A2A agents in this workspace",
];

const CHROMELESS_PATHS = ["/approval"];

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border bg-card text-foreground">
            <IconBellCog size={17} />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">
              Dispatch
            </div>
            <div className="text-xs text-muted-foreground">
              Workspace control plane
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      "flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm",
                      isActive
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )
                  }
                >
                  <Icon size={16} className="shrink-0" />
                  <span className="truncate">{item.label}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t px-2 py-2">
        <ToolsSidebarSection />
        <FeedbackButton />
      </div>
    </>
  );
}

export function DispatchShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (CHROMELESS_PATHS.some((path) => location.pathname === path)) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
        <NavContent />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-72 p-0 bg-sidebar text-sidebar-foreground [&>button]:hidden"
        >
          <div className="flex h-full w-full flex-col">
            <NavContent onNavigate={() => setMobileOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <AgentSidebar
        position="right"
        defaultOpen
        emptyStateText="Manage routes, identities, approvals, and jobs."
        suggestions={SIDEBAR_SUGGESTIONS}
      >
        <div className="flex h-full flex-1 flex-col overflow-hidden">
          <header className="flex h-14 shrink-0 items-center justify-between border-b px-4 sm:px-6">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 md:hidden"
                onClick={() => setMobileOpen(true)}
              >
                <IconLayoutSidebar />
              </Button>
              <div className="text-sm font-medium text-muted-foreground">
                Workspace control plane
              </div>
            </div>
            <AgentToggleButton />
          </header>

          <InvitationBanner />

          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
              <div className="border-b pb-4">
                <h1 className="text-2xl font-semibold text-foreground">
                  {title}
                </h1>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                  {description}
                </p>
              </div>
              <div className="mt-5 space-y-5">{children}</div>
            </div>
          </main>
        </div>
      </AgentSidebar>
    </div>
  );
}
