import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconApps } from "@tabler/icons-react";
import { Link, useLocation } from "react-router";

import {
  filterOtherApps,
  type ConnectedAppSummary,
} from "../../lib/other-apps";
import { cn } from "../../lib/utils";
import {
  isWorkspaceAppVisibleInDefaultLaunchers,
  workspaceAppIdFromRoute,
  workspaceAppRoute,
  workspaceAppHref,
  type WorkspaceAppSummary,
} from "../../lib/workspace-apps";
import { AppIcon } from "../app-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

function appMatchesPath(app: WorkspaceAppSummary, pathname: string): boolean {
  return workspaceAppIdFromRoute(pathname) === app.id;
}

function appLabel(app: WorkspaceAppSummary): string {
  return app.name.trim() || app.id;
}

type RailApp = WorkspaceAppSummary & { external?: boolean };

export function WorkspaceAppsRail({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const t = useT();
  const location = useLocation();
  const appsQuery = useActionQuery<WorkspaceAppSummary[]>(
    "list-workspace-apps",
    {
      includeAgentCards: false,
    },
  );
  const connectedAppsQuery = useActionQuery<ConnectedAppSummary[]>(
    "list-connected-agents",
    {},
  );
  if (appsQuery.isError || !appsQuery.data) return null;

  const workspaceApps = appsQuery.data;
  const apps: RailApp[] = [
    ...workspaceApps.filter(
      (app) =>
        isWorkspaceAppVisibleInDefaultLaunchers(app) &&
        !app.archived &&
        app.status !== "pending" &&
        !!workspaceAppHref(app),
    ),
    ...filterOtherApps(connectedAppsQuery.data ?? [], workspaceApps).map(
      (app) => ({
        id: app.id,
        name: app.name,
        description: app.description,
        path: "",
        url: app.homeUrl ?? app.url,
        status: "ready" as const,
        external: true,
      }),
    ),
  ].sort((a, b) => appLabel(a).localeCompare(appLabel(b)));

  if (apps.length === 0) return null;

  const renderAppLink = (app: RailApp) => {
    const href = workspaceAppHref(app);
    if (!href) return null;

    const label = appLabel(app);
    const active = appMatchesPath(app, location.pathname);
    const linkProps = {
      "aria-current": active ? ("page" as const) : undefined,
      "aria-label": collapsed ? label : undefined,
      onClick: onNavigate,
      className: cn(
        "flex h-9 items-center rounded-md text-sm transition-colors",
        collapsed ? "w-9 justify-center" : "w-full gap-2 px-2 text-start",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      ),
    };
    const linkContent = (
      <>
        <AppIcon
          id={app.id}
          name={label}
          size="sm"
          monochrome
          className={cn("size-5 rounded-md", active && "ring-1 ring-ring/30")}
        />
        {!collapsed ? <span className="truncate">{label}</span> : null}
      </>
    );
    const link = app.external ? (
      <a href={href} {...linkProps}>
        {linkContent}
      </a>
    ) : (
      <Link to={workspaceAppRoute(app.id)} {...linkProps}>
        {linkContent}
      </Link>
    );

    if (!collapsed) return link;

    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <div
      className={cn(
        "mt-4 border-t border-sidebar-border pt-3",
        collapsed ? "px-1.5" : "px-2",
      )}
      data-dispatch-apps-rail
    >
      {!collapsed ? (
        <div className="mb-1 flex items-center gap-1.5 px-2 text-[11px] font-medium uppercase tracking-wide text-sidebar-foreground/45">
          <IconApps size={13} />
          <span>
            {t("dispatch.pages.workspaceApps", {
              defaultValue: "Workspace apps",
            })}
          </span>
        </div>
      ) : (
        <span className="sr-only">
          {t("dispatch.pages.workspaceApps", {
            defaultValue: "Workspace apps",
          })}
        </span>
      )}
      <ul
        className={cn(
          collapsed ? "flex flex-col items-center gap-1" : "space-y-0.5",
        )}
      >
        {apps.map((app) => {
          const href = workspaceAppHref(app);
          if (!href) return null;
          return <li key={app.id}>{renderAppLink(app)}</li>;
        })}
      </ul>
    </div>
  );
}
