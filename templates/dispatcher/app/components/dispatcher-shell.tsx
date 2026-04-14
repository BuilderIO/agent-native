import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { AgentSidebar, AgentToggleButton } from "@agent-native/core/client";
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
  IconPuzzle,
  IconShieldCheck,
  IconUsersGroup,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

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

export function DispatcherShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <SidebarProvider defaultOpen>
      <AgentSidebar
        position="right"
        defaultOpen
        emptyStateText="Manage routes, identities, approvals, and jobs."
        suggestions={SIDEBAR_SUGGESTIONS}
      >
        <div className="flex min-h-screen w-full bg-background">
          <Sidebar collapsible="offcanvas" className="border-r">
            <SidebarHeader className="border-b px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border bg-card text-foreground">
                  <IconBellCog size={17} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    Dispatcher
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Workspace control plane
                  </div>
                </div>
              </div>
            </SidebarHeader>

            <SidebarContent className="px-2 py-3">
              <SidebarMenu>
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild tooltip={item.label}>
                        <NavLink to={item.to}>
                          {({ isActive }) => (
                            <span
                              className={cn(
                                "flex items-center gap-2",
                                isActive && "text-foreground",
                              )}
                              data-active={isActive}
                            >
                              <Icon size={16} />
                              <span>{item.label}</span>
                            </span>
                          )}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarContent>
          </Sidebar>

          <SidebarInset className="bg-background">
            <header className="flex h-14 items-center justify-between border-b px-4 sm:px-6">
              <div className="flex items-center gap-2">
                <SidebarTrigger className="md:hidden" />
                <div className="text-sm font-medium text-muted-foreground">
                  Workspace control plane
                </div>
              </div>
              <AgentToggleButton />
            </header>

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
          </SidebarInset>
        </div>
      </AgentSidebar>
    </SidebarProvider>
  );
}
