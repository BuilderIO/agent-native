import { useT } from "@agent-native/core/client/i18n";
import { useOrgRole } from "@agent-native/core/client/org";
import { buildSettingsRoute } from "@agent-native/core/navigation";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { cn } from "../lib/utils";
import type { WorkspaceAppTiers } from "../lib/workspace-app-layout";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

function TierHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <h2 className="truncate text-sm font-semibold text-foreground">
        {title}
      </h2>
      {/* Takes the rest of the row so a wide action wraps inside it. */}
      {action ? (
        <div className="flex min-w-0 flex-1 justify-end">{action}</div>
      ) : null}
    </div>
  );
}

/** The Apps tier's empty text when the workspace has no apps of its own. */
export function NoWorkspaceAppsText() {
  const t = useT();
  return (
    <p className="px-4 py-3 text-sm text-muted-foreground">
      {t("dispatch.pages.chatFirstNoWorkspaceApps")}
    </p>
  );
}

function ManageHostedAppsLink() {
  const t = useT();
  const { org, canManageOrg, isLoading } = useOrgRole();
  const label = t("dispatch.pages.manageHostedApps");
  // Settings › Organization › Apps only exists inside an organization.
  if (isLoading || !org?.orgId) return null;
  if (canManageOrg) {
    return (
      <Button variant="ghost" size="sm" asChild>
        <Link to={buildSettingsRoute("apps")} className="text-muted-foreground">
          {label}
        </Link>
      </Button>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-md">
          <Button variant="ghost" size="sm" disabled>
            {label}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {t("dispatch.pages.manageHostedAppsAdminOnly")}
      </TooltipContent>
    </Tooltip>
  );
}

/** View all, search and New app: the header cluster of every app list. */
export function AppListActions({
  viewAllHref,
  search,
  newApp,
}: {
  viewAllHref?: string | undefined;
  search?: ReactNode;
  newApp?: ReactNode;
}) {
  const t = useT();
  return (
    // Below `sm` the search takes its own full-width line under the buttons.
    <div
      data-app-list-actions
      className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5 sm:flex-nowrap"
    >
      {viewAllHref ? (
        <Button variant="ghost" size="sm" asChild>
          <Link to={viewAllHref} className="text-muted-foreground">
            {t("dispatch.pages.viewAllApps")}
          </Link>
        </Button>
      ) : null}
      {search ? (
        <div className="order-last min-w-0 basis-full sm:order-none sm:basis-auto">
          {search}
        </div>
      ) : null}
      {newApp}
    </div>
  );
}

/**
 * Pinned (only when something is pinned), Apps, then Hosted apps. The Apps
 * tier always renders. `actions` sit in the first header; `hasPinnedApps` is
 * decided before a search filters, so a query that matches no pinned app does
 * not move the search while typing.
 */
export function AppTierSections<T>({
  tiers,
  appsTitle,
  actions,
  hasPinnedApps = tiers.pinned.length > 0,
  appsFallback,
  renderItems,
  className,
}: {
  tiers: WorkspaceAppTiers<T>;
  appsTitle: string;
  actions?: ReactNode;
  hasPinnedApps?: boolean | undefined;
  /** Shown in the Apps tier when it has no rows (loading, empty, no matches). */
  appsFallback?: ReactNode;
  renderItems: (items: T[]) => ReactNode;
  className?: string;
}) {
  const t = useT();
  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {hasPinnedApps ? (
        <section
          aria-label={t("dispatch.pages.pinnedApps")}
          className="flex flex-col gap-3"
        >
          <TierHeader title={t("dispatch.pages.pinnedApps")} action={actions} />
          {tiers.pinned.length > 0 ? renderItems(tiers.pinned) : null}
        </section>
      ) : null}
      <section aria-label={appsTitle} className="flex flex-col gap-3">
        <TierHeader
          title={appsTitle}
          action={hasPinnedApps ? undefined : actions}
        />
        {tiers.apps.length > 0 ? renderItems(tiers.apps) : appsFallback}
      </section>
      {tiers.hosted.length > 0 ? (
        <section
          aria-label={t("dispatch.pages.hostedApps")}
          className="flex flex-col gap-3"
        >
          <TierHeader
            title={t("dispatch.pages.hostedApps")}
            action={<ManageHostedAppsLink />}
          />
          {renderItems(tiers.hosted)}
        </section>
      ) : null}
    </div>
  );
}
