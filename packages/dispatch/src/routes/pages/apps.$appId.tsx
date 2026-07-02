import { useActionQuery, useT } from "@agent-native/core/client";
import {
  IconArrowLeft,
  IconArrowUpRight,
  IconClockHour4,
} from "@tabler/icons-react";
import { useEffect, useMemo } from "react";
import { Link, useParams } from "react-router";

import { DispatchShell } from "@/components/dispatch-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  workspaceAppHref,
  type WorkspaceAppSummary,
} from "@/lib/workspace-apps";

export function meta() {
  return [{ title: "Workspace app - Dispatch" }];
}

export default function WorkspaceAppRoute() {
  const t = useT();
  const { appId } = useParams();
  const { data: apps = [], isLoading } = useActionQuery(
    "list-workspace-apps",
    { includeAgentCards: false },
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
      title={app?.name || t("dispatch.pages.workspaceAppFallback")}
      description={t("dispatch.pages.workspaceAppDescription")}
    >
      <div className="max-w-2xl rounded-lg border bg-card p-5">
        <Button asChild size="sm" variant="ghost" className="-ml-2 mb-4">
          <Link to="/apps">
            <IconArrowLeft size={15} className="mr-1.5" />
            {t("dispatch.nav.apps")}
          </Link>
        </Button>

        {isLoading && !app ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : !app ? (
          <div className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">
              {t("dispatch.pages.appNotFound")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("dispatch.pages.pageNotFoundDescription")}
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
                {t("dispatch.pages.building")}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("dispatch.pages.appBuildingPrefix")}{" "}
              <span className="font-mono text-foreground">{app.path}</span>{" "}
              {t("dispatch.pages.appBuildingSuffix")}
            </p>
            {app.branchName ? (
              <p className="text-xs text-muted-foreground">
                {t("dispatch.pages.branch", { branch: app.branchName })}
              </p>
            ) : null}
            {app.builderUrl ? (
              <Button asChild>
                <a href={app.builderUrl} target="_blank" rel="noreferrer">
                  {t("dispatch.pages.openBuilderBranch")}
                  <IconArrowUpRight size={15} className="ml-1.5" />
                </a>
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">
              {t("dispatch.pages.openingApp", { name: app.name })}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("dispatch.pages.redirectingTo")}{" "}
              <span className="font-mono text-foreground">{app.path}</span>.
            </p>
            {href ? (
              <Button asChild>
                <a href={href}>
                  {t("dispatch.pages.openApp")}
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
