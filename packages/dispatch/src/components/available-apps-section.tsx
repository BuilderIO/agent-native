import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { withBuilderUtmTrackingParams } from "@agent-native/core/shared/builder-link-tracking";
import {
  IconCircleCheck,
  IconLoader2,
  IconPencil,
  IconPlus,
} from "@tabler/icons-react";
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

interface CustomizeAppResult {
  mode: "builder" | "local-agent" | "builder-unavailable" | "coming-soon";
  message: string;
  prompt?: string;
  url?: string;
}

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
  const customize = useActionMutation<
    CustomizeAppResult,
    { appId: string; description: string; prompt: string }
  >("start-workspace-app-creation", {
    onSuccess: (result) => {
      if (result.mode === "builder" && result.url) {
        const builderUrl = withBuilderUtmTrackingParams(result.url, {
          campaign: "product",
          content: "available_app_customize",
        });
        toast.success(
          t("dispatch.pages.customizeStarted", {
            defaultValue: "Builder customization started",
          }),
          {
            action: {
              label: t("dispatch.pages.openInBuilder", {
                defaultValue: "Open in Builder",
              }),
              onClick: () =>
                window.open(builderUrl, "_blank", "noopener,noreferrer"),
            },
          },
        );
        return;
      }
      if (result.mode === "local-agent" && result.prompt) {
        sendToAgentChat({
          message: result.prompt,
          submit: true,
          type: "code",
          newTab: true,
          reuseEmptyTab: true,
        });
        toast.success(
          t("dispatch.pages.customizeSent", {
            defaultValue: "Sent to the local agent",
          }),
        );
        return;
      }
      toast.error(result.message);
    },
    onError: (error) => toast.error(error.message),
  });
  const connect = useActionMutation("connect-external-agent", {
    onSuccess: () => {
      toast.success(
        t("dispatch.pages.appConnected", { defaultValue: "App added" }),
      );
      onConnected?.();
    },
    onError: (error) => toast.error(error.message),
  });

  function customizeApp() {
    customize.mutate({
      appId: `${app.id}-custom-${crypto.randomUUID().slice(0, 8)}`,
      description: `A customized version of ${app.name}.`,
      prompt: [
        `Create a private customized copy of ${app.name}.`,
        `Use ${availableAppUrl(app.id)} as the source app to clone.`,
        "Preserve its core workflow and visual shell, use synthetic data only, and keep the new app independent.",
      ].join(" "),
    });
  }

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
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={customize.isPending}
          onClick={customizeApp}
        >
          {customize.isPending ? (
            <IconLoader2 size={15} className="mr-1.5 animate-spin" />
          ) : (
            <IconPencil size={15} className="mr-1.5" />
          )}
          {t("dispatch.pages.customizeApp", { defaultValue: "Customize" })}
        </Button>
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
      </div>
    </AppListRow>
  );
}
