import { withBuilderUtmTrackingParams } from "@agent-native/core/shared/builder-link-tracking";
import type { MouseEvent } from "react";

import type { ConnectedAppSummary } from "../lib/other-apps";
import {
  navigateToWorkspaceApp,
  shouldOpenWorkspaceAppInTopWindow,
} from "../lib/workspace-apps";
import { AppIcon } from "./app-icon";
import { AppListRow } from "./app-list-row";
import { AppOpenActions } from "./app-open-actions";

export function ConnectedAppCard({
  app,
  className,
}: {
  app: ConnectedAppSummary;
  className?: string;
}) {
  const launchUrl = app.homeUrl ?? app.url;
  const trackedLaunchUrl = withBuilderUtmTrackingParams(launchUrl, {
    campaign: "product",
    content: "dispatch_app",
  });
  const handleActionClick = (event: MouseEvent<HTMLDivElement>) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const anchor =
      event.target instanceof Element ? event.target.closest("a") : null;
    if (
      !anchor ||
      anchor.target === "_blank" ||
      !shouldOpenWorkspaceAppInTopWindow()
    ) {
      return;
    }
    if (navigateToWorkspaceApp(anchor.href)) event.preventDefault();
  };

  return (
    <AppListRow className={className}>
      <AppIcon id={app.id} name={app.name} color={app.color} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">
          {app.name}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {app.description || app.url}
        </div>
      </div>
      <div className="flex shrink-0" onClickCapture={handleActionClick}>
        <AppOpenActions
          name={app.name}
          href={trackedLaunchUrl}
          rel="noopener noreferrer"
          showNewTabOption
        />
      </div>
    </AppListRow>
  );
}
