import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router";
import { AgentSidebar, AgentToggleButton } from "@agent-native/core/client";
import {
  IconArrowUpRight,
  IconBellCog,
  IconBolt,
  IconBroadcast,
  IconFingerprint,
  IconHistory,
  IconShieldCheck,
  IconUsersGroup,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/overview", label: "Overview", icon: IconBroadcast },
  { to: "/destinations", label: "Routes", icon: IconArrowUpRight },
  { to: "/identities", label: "Identities", icon: IconFingerprint },
  { to: "/approvals", label: "Approvals", icon: IconShieldCheck },
  { to: "/audit", label: "Audit", icon: IconHistory },
  { to: "/team", label: "Team", icon: IconUsersGroup },
] as const;

const SIDEBAR_SUGGESTIONS = [
  "Create a Slack destination for #daily-digest",
  "Make a Telegram link token for me",
  "Set up a weekday 8am digest job",
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
  const location = useLocation();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.12),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.12),_transparent_24%),linear-gradient(180deg,_hsl(var(--background)),_rgba(15,23,42,0.92))]">
      <AgentSidebar
        position="right"
        defaultOpen
        emptyStateText="Route messages, spin up jobs, or delegate to the right agent."
        suggestions={SIDEBAR_SUGGESTIONS}
      >
        <div className="min-h-screen">
          <header className="sticky top-0 z-20 border-b border-border/60 bg-background/85 backdrop-blur">
            <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-amber-400/30 bg-amber-400/10 text-amber-200 shadow-[0_0_0_1px_rgba(251,191,36,0.08),0_12px_32px_rgba(251,191,36,0.12)]">
                  <IconBellCog size={18} />
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                    Workspace Router
                  </div>
                  <div className="text-sm font-semibold text-foreground">
                    Dispatcher
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="hidden items-center gap-2 rounded-full border border-border/60 bg-muted/50 px-3 py-1 text-[11px] text-muted-foreground sm:flex">
                  <IconBolt size={12} />
                  One inbox for Slack, Telegram, jobs, and A2A delegation
                </div>
                <AgentToggleButton />
              </div>
            </div>
          </header>

          <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:py-8">
            <aside className="rounded-3xl border border-border/60 bg-card/70 p-3 shadow-[0_24px_80px_rgba(15,23,42,0.22)] backdrop-blur">
              <div className="mb-3 rounded-2xl border border-border/50 bg-muted/40 p-4">
                <div className="text-xs font-medium text-foreground">
                  Central routing surface
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Connect messaging once, delegate through A2A, and keep durable
                  behavior visible through resources, approvals, and audit.
                </p>
              </div>
              <nav className="space-y-1">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-colors",
                          isActive
                            ? "bg-foreground text-background shadow-sm"
                            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                        )
                      }
                    >
                      <Icon size={16} />
                      {item.label}
                    </NavLink>
                  );
                })}
              </nav>
              <div className="mt-4 rounded-2xl border border-sky-400/20 bg-sky-400/10 p-4 text-[11px] text-sky-100">
                <div className="font-medium">Current view</div>
                <div className="mt-1 text-sky-100/80">
                  {location.pathname.replace("/", "") || "overview"}
                </div>
              </div>
            </aside>

            <section className="space-y-5">
              <div className="rounded-[28px] border border-border/60 bg-card/80 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.2)] backdrop-blur">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                      Dispatcher Console
                    </div>
                    <h1 className="mt-2 font-serif text-3xl text-foreground">
                      {title}
                    </h1>
                  </div>
                  <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                </div>
              </div>
              {children}
            </section>
          </main>
        </div>
      </AgentSidebar>
    </div>
  );
}
