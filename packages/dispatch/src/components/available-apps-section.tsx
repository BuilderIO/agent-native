import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconCircleCheck, IconLoader2, IconPlus } from "@tabler/icons-react";
import { toast } from "sonner";

import {
  AVAILABLE_APPS,
  availableAppUrl,
  type AvailableApp,
} from "../lib/available-apps";
import type { ConnectedAppSummary, WorkspaceAppId } from "../lib/other-apps";
import { cn } from "../lib/utils";
import { AppIcon } from "./app-icon";
import {
  APP_LIST_GRID_CLASS,
  APP_LIST_GRID_ROW_CLASS,
  AppList,
  AppListRow,
} from "./app-list-row";
import { Button } from "./ui/button";

export function AvailableAppsSection({
  connectedApps,
  workspaceApps,
  query = "",
  onConnected,
  className,
}: {
  connectedApps: ConnectedAppSummary[];
  workspaceApps: WorkspaceAppId[];
  query?: string;
  onConnected?: () => void;
  className?: string;
}) {
  const t = useT();
  const connectedIds = new Set(
    [
      ...connectedApps.map((app) => app.id),
      ...workspaceApps.map((app) => app.id),
    ].map((id) => id.trim().toLowerCase()),
  );
  const normalizedQuery = query.trim().toLowerCase();
  const apps = AVAILABLE_APPS.filter(
    (app) =>
      !normalizedQuery ||
      `${app.name} ${app.description}`.toLowerCase().includes(normalizedQuery),
  );

  if (apps.length === 0) return null;

  return (
    <section className={cn("space-y-3", className)}>
      <h2 className="truncate text-sm font-semibold text-foreground">
        {t("dispatch.pages.availableApps", {
          defaultValue: "Available apps",
        })}
      </h2>
      <AppList className={APP_LIST_GRID_CLASS}>
        {apps.map((app) => (
          <AvailableAppRow
            key={app.id}
            app={app}
            connected={connectedIds.has(app.id)}
            className={APP_LIST_GRID_ROW_CLASS}
            onConnected={onConnected}
          />
        ))}
      </AppList>
    </section>
  );
}

function AvailableAppRow({
  app,
  connected,
  className,
  onConnected,
}: {
  app: AvailableApp;
  connected: boolean;
  className?: string;
  onConnected?: () => void;
}) {
  const t = useT();
  const connect = useActionMutation("connect-external-agent", {
    onSuccess: () => {
      toast.success(
        t("dispatch.pages.appConnected", { defaultValue: "App added" }),
      );
      onConnected?.();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <AppListRow className={className}>
      <AppIcon id={app.id} name={app.name} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">
          {app.name}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {app.description}
        </div>
      </div>
      {connected ? (
        <div className="flex shrink-0 items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs text-primary">
            <IconCircleCheck size={13} />
            {t("dispatch.pages.appAdded", { defaultValue: "Added" })}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("dispatch.pages.appPersonal", { defaultValue: "Personal" })}
          </span>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={connect.isPending}
          onClick={() =>
            connect.mutate({
              url: availableAppUrl(app.id),
              name: app.name,
              description: app.description,
              scope: "personal",
            })
          }
        >
          {connect.isPending ? (
            <IconLoader2 size={15} className="mr-1.5 animate-spin" />
          ) : (
            <IconPlus size={15} className="mr-1.5" />
          )}
          {t("dispatch.pages.addApp", { defaultValue: "Add" })}
        </Button>
      )}
    </AppListRow>
  );
}
