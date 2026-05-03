import { Link } from "react-router";
import { useActionQuery } from "@agent-native/core/client";
import {
  IconArrowUpRight,
  IconApps,
  IconClockHour4,
  IconPlus,
} from "@tabler/icons-react";
import { CreateAppPopover } from "@/components/create-app-popover";
import { DispatchShell } from "@/components/dispatch-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface WorkspaceAppSummary {
  id: string;
  name: string;
  description?: string;
  path: string;
  url?: string | null;
  isDispatch: boolean;
  status?: "ready" | "pending";
  statusLabel?: string;
  builderUrl?: string | null;
  branchName?: string | null;
}

function workspaceAppHref(app: WorkspaceAppSummary): string | null {
  if (app.status === "pending") return app.builderUrl || null;
  return app.url || app.path || null;
}

function isExternalHref(href: string): boolean {
  if (!/^https?:\/\//i.test(href)) return false;
  if (typeof window === "undefined") return true;
  try {
    return (
      new URL(href, window.location.href).origin !== window.location.origin
    );
  } catch {
    return true;
  }
}

export function meta() {
  return [{ title: "Apps — Dispatch" }];
}

export default function AppsRoute() {
  const { data: apps = [] } = useActionQuery(
    "list-workspace-apps",
    { includeAgentCards: false },
    {
      refetchInterval: 2_000,
    },
  );
  const typedApps = (apps as WorkspaceAppSummary[]).filter(
    (app) => !app.isDispatch,
  );

  return (
    <DispatchShell
      title="Apps"
      description="Open workspace apps and start new app creation from Dispatch."
    >
      <div className="space-y-4">
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <IconApps size={16} className="text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">
                Workspace apps
              </h2>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link to="/new-app">
                <IconPlus size={15} className="mr-1.5" />
                App
              </Link>
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {typedApps.map((app) => {
              const href = workspaceAppHref(app);
              const external = href ? isExternalHref(href) : false;
              return (
                <a
                  key={app.id}
                  href={href ?? undefined}
                  target={external ? "_blank" : undefined}
                  rel={external ? "noreferrer" : undefined}
                  aria-disabled={!href}
                  className="group rounded-lg border bg-card p-4 transition hover:border-foreground/30 aria-disabled:pointer-events-none aria-disabled:opacity-60"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-foreground">
                          {app.name}
                        </h3>
                        {app.status === "pending" ? (
                          <Badge
                            variant="outline"
                            className="shrink-0 gap-1 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                          >
                            <IconClockHour4 size={12} />
                            Building
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                        {app.path}
                      </p>
                      {app.status === "pending" && app.branchName ? (
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          Branch: {app.branchName}
                        </p>
                      ) : null}
                      {app.description ? (
                        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                          {app.description}
                        </p>
                      ) : null}
                    </div>
                    <IconArrowUpRight
                      size={16}
                      className="shrink-0 text-muted-foreground transition group-hover:text-foreground"
                    />
                  </div>
                </a>
              );
            })}

            <CreateAppPopover />
          </div>
        </section>
      </div>
    </DispatchShell>
  );
}
