import { useT } from "@agent-native/core/client/i18n";
import { withBuilderUtmTrackingParams } from "@agent-native/core/shared/builder-link-tracking";
import { IconArrowUpRight } from "@tabler/icons-react";

import type { ConnectedAppSummary } from "../lib/other-apps";

export function ConnectedAppCard({ app }: { app: ConnectedAppSummary }) {
  const t = useT();

  return (
    <a
      href={withBuilderUtmTrackingParams(app.url, {
        campaign: "product",
        content: "dispatch_app",
      })}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex min-h-[116px] items-start gap-3 rounded-xl bg-card/40 p-4 transition-[background-color] hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
        {app.name.charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-3">
          <span className="truncate text-sm font-semibold text-foreground">
            {app.name}
          </span>
          <IconArrowUpRight
            size={15}
            className="shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
          />
        </span>
        <span className="mt-2 line-clamp-2 block text-[13px] leading-5 text-muted-foreground">
          {app.description || app.url}
        </span>
        <span className="mt-3 block text-xs font-medium text-foreground">
          {t("dispatch.pages.openApp")}
        </span>
      </span>
    </a>
  );
}
