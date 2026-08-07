import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconApps } from "@tabler/icons-react";
import { useLocation } from "react-router";

import { cn } from "../../lib/utils";
import {
  workspaceAppHref,
  type WorkspaceAppSummary,
} from "../../lib/workspace-apps";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

function pathFromValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const pathname = new URL(trimmed, "https://dispatch.local").pathname;
    return pathname.replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
}

function appMatchesPath(app: WorkspaceAppSummary, pathname: string): boolean {
  const candidatePaths = [app.path, app.url]
    .map(pathFromValue)
    .filter((path): path is string => !!path);

  return candidatePaths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

function appInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "A";
}

function appLabel(app: WorkspaceAppSummary): string {
  return app.name.trim() || app.id;
}

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
  if (appsQuery.isError || !appsQuery.data) return null;

  const apps = appsQuery.data
    .filter(
      (app) =>
        !app.isDispatch &&
        !app.archived &&
        app.status !== "pending" &&
        !!workspaceAppHref(app),
    )
    .sort((a, b) => appLabel(a).localeCompare(appLabel(b)));

  if (apps.length === 0) return null;

  const renderAppLink = (app: WorkspaceAppSummary) => {
    const href = workspaceAppHref(app);
    if (!href) return null;

    const label = appLabel(app);
    const active = appMatchesPath(app, location.pathname);
    const link = (
      <a
        href={href}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? label : undefined}
        onClick={onNavigate}
        className={cn(
          "flex h-8 items-center rounded-md text-sm transition-colors",
          collapsed ? "w-8 justify-center" : "w-full gap-2 px-2 text-start",
          active
            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
      >
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded text-[10px] font-semibold",
            active
              ? "bg-sidebar-primary text-sidebar-primary-foreground"
              : "bg-sidebar-accent text-sidebar-foreground/70",
          )}
        >
          {appInitial(label)}
        </span>
        {!collapsed ? <span className="truncate">{label}</span> : null}
      </a>
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
        collapsed ? "px-1" : "px-2",
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
