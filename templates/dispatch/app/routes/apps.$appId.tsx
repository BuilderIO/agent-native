import { useEffect, useMemo } from "react";
import { Link, useParams } from "react-router";
import { useActionQuery } from "@agent-native/core/client";
import {
  IconArrowLeft,
  IconArrowUpRight,
  IconClockHour4,
} from "@tabler/icons-react";
import { DispatchShell } from "@/components/dispatch-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface WorkspaceAppSummary {
  id: string;
  name: string;
  description?: string;
  path: string;
  url?: string | null;
  status?: "ready" | "pending";
  statusLabel?: string;
  builderUrl?: string | null;
  branchName?: string | null;
}

function workspaceAppHref(app: WorkspaceAppSummary): string | null {
  if (app.status === "pending") return app.builderUrl || null;
  return app.url || app.path || null;
}

export function meta() {
  return [{ title: "Workspace app - Dispatch" }];
}

export default function WorkspaceAppRoute() {
  const { appId } = useParams();
  const { data: apps = [], isLoading } = useActionQuery(
    "list-workspace-apps",
    {},
    {
      refetchInterval: 2_000,
    },
  );
  const app = useMemo(
    () =>
      (apps as WorkspaceAppSummary[]).find((item) => item.id === appId) ?? null,
    [appId, apps],
  );
  const href = app ? workspaceAppHref(app) : null;

  useEffect(() => {
    if (!app || app.status === "pending" || !href) return;
    window.location.assign(href);
  }, [app, href]);

  return (
    <DispatchShell
      title={app?.name || "Workspace App"}
      description="Open a deployed app or check the status of an app being created."
    >
      <div className="max-w-2xl rounded-lg border bg-card p-5">
        <Button asChild size="sm" variant="ghost" className="-ml-2 mb-4">
          <Link to="/apps">
            <IconArrowLeft size={15} className="mr-1.5" />
            Apps
          </Link>
        </Button>

        {isLoading && !app ? (
          <p className="text-sm text-muted-foreground">Loading app status...</p>
        ) : !app ? (
          <div className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">
              App not found
            </h2>
            <p className="text-sm text-muted-foreground">
              This route is not in the workspace app list yet.
            </p>
          </div>
        ) : app.status === "pending" ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">
                {app.name}
              </h2>
              <Badge
                variant="outline"
                className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              >
                <IconClockHour4 size={12} />
                Building
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              This app is being created. It will be available at{" "}
              <span className="font-mono text-foreground">{app.path}</span>{" "}
              after its branch is merged and the workspace deploy finishes.
            </p>
            {app.branchName ? (
              <p className="text-xs text-muted-foreground">
                Branch: {app.branchName}
              </p>
            ) : null}
            {app.builderUrl ? (
              <Button asChild>
                <a href={app.builderUrl} target="_blank" rel="noreferrer">
                  Open Builder branch
                  <IconArrowUpRight size={15} className="ml-1.5" />
                </a>
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">
              Opening {app.name}
            </h2>
            <p className="text-sm text-muted-foreground">
              Redirecting to{" "}
              <span className="font-mono text-foreground">{app.path}</span>.
            </p>
            {href ? (
              <Button asChild>
                <a href={href}>
                  Open app
                  <IconArrowUpRight size={15} className="ml-1.5" />
                </a>
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </DispatchShell>
  );
}
