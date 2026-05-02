import { Link } from "react-router";
import { useActionQuery } from "@agent-native/core/client";
import { IconArrowUpRight, IconApps, IconPlus } from "@tabler/icons-react";
import { DispatchShell } from "@/components/dispatch-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface WorkspaceAppSummary {
  id: string;
  name: string;
  description?: string;
  path: string;
  isDispatch: boolean;
}

export function meta() {
  return [{ title: "Apps — Dispatch" }];
}

export default function AppsRoute() {
  const { data: apps = [] } = useActionQuery(
    "list-workspace-apps",
    {},
    {
      refetchInterval: 2_000,
    },
  );
  const typedApps = apps as WorkspaceAppSummary[];

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
            <Button asChild size="sm">
              <Link to="/new-app">
                <IconPlus size={15} className="mr-1.5" />
                App
              </Link>
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {typedApps.map((app) => (
              <a
                key={app.id}
                href={app.path}
                className="group rounded-lg border bg-card p-4 transition hover:border-foreground/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-foreground">
                        {app.name}
                      </h3>
                      {app.isDispatch ? (
                        <Badge variant="secondary">Control plane</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                      {app.path}
                    </p>
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
            ))}

            <Link
              to="/new-app"
              className="flex min-h-32 items-center justify-center rounded-lg border border-dashed bg-card p-4 text-sm font-medium text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
            >
              <span className="inline-flex items-center gap-2">
                <IconPlus size={16} />
                App
              </span>
            </Link>
          </div>
        </section>
      </div>
    </DispatchShell>
  );
}
