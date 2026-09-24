import { withBuilderUtmTrackingParams } from "@agent-native/core/shared/builder-link-tracking";

import type { ConnectedAppSummary } from "../lib/other-apps";
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
      <AppOpenActions
        name={app.name}
        href={withBuilderUtmTrackingParams(launchUrl, {
          campaign: "product",
          content: "dispatch_app",
        })}
        rel="noopener noreferrer"
        showNewTabOption
      />
    </AppListRow>
  );
}
