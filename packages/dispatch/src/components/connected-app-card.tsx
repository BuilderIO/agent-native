import { withBuilderUtmTrackingParams } from "@agent-native/core/shared/builder-link-tracking";
import { IconArrowUpRight } from "@tabler/icons-react";

import type { ConnectedAppSummary } from "../lib/other-apps";
import { AppIcon } from "./app-icon";
import { AppListRow } from "./app-list-row";
import { Button } from "./ui/button";

export function ConnectedAppCard({ app }: { app: ConnectedAppSummary }) {
  return (
    <AppListRow>
      <AppIcon id={app.id} name={app.name} color={app.color} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">
          {app.name}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {app.description || app.url}
        </div>
      </div>
      <Button asChild variant="outline" size="sm" className="shrink-0">
        <a
          href={withBuilderUtmTrackingParams(app.url, {
            campaign: "product",
            content: "dispatch_app",
          })}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open
          <IconArrowUpRight />
        </a>
      </Button>
    </AppListRow>
  );
}
