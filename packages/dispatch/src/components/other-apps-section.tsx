import { useT } from "@agent-native/core/client/i18n";
import { IconStack2 } from "@tabler/icons-react";

import { filterOtherApps, type ConnectedAppSummary } from "../lib/other-apps";
import type { WorkspaceAppId } from "../lib/other-apps";
import { cn } from "../lib/utils";
import { ActionQueryError } from "./action-query-error";
import {
  APP_LIST_GRID_CLASS,
  APP_LIST_GRID_ROW_CLASS,
  AppList,
} from "./app-list-row";
import { ConnectedAppCard } from "./connected-app-card";
import { Skeleton } from "./ui/skeleton";
import {
  WorkspaceTemplateCard,
  type CuratedWorkspaceTemplate,
  type CuratedWorkspaceTemplatesResult,
  type WorkspaceTemplateLabels,
} from "./workspace-template-card";

type OtherAppEntry =
  | { kind: "template"; template: CuratedWorkspaceTemplate }
  | { kind: "connected"; app: ConnectedAppSummary };

function templateKey(template: CuratedWorkspaceTemplate): string {
  return (template.templateId || template.id || template.appId || template.name)
    .trim()
    .toLowerCase();
}

function getTemplateItems(
  result: CuratedWorkspaceTemplatesResult | undefined,
): CuratedWorkspaceTemplate[] {
  if (!result) return [];
  return Array.isArray(result) ? result : result.templates;
}

export function mergeOtherAppEntries({
  templates,
  connectedApps,
  workspaceApps,
}: {
  templates?: CuratedWorkspaceTemplatesResult;
  connectedApps: ConnectedAppSummary[];
  workspaceApps: WorkspaceAppId[];
}): OtherAppEntry[] {
  const workspaceAppIds = new Set(
    workspaceApps.map((app) => app.id.trim().toLowerCase()),
  );
  const seen = new Set<string>();
  const entries: OtherAppEntry[] = [];

  for (const template of getTemplateItems(templates)) {
    const id = templateKey(template);
    if (!id || template.installed || workspaceAppIds.has(id)) continue;
    seen.add(id);
    entries.push({ kind: "template", template });
  }

  for (const app of filterOtherApps(connectedApps, workspaceApps)) {
    const id = app.id.trim().toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    entries.push({ kind: "connected", app });
  }

  return entries;
}

export function OtherAppsSection({
  templates,
  connectedApps = [],
  workspaceApps,
  templatesLoading = false,
  connectedAppsLoading = false,
  templatesError,
  connectedAppsError,
  onRetryTemplates,
  onRetryConnectedApps,
  templateLabels,
  onRemixSuccess,
  className,
}: {
  templates?: CuratedWorkspaceTemplatesResult;
  connectedApps?: ConnectedAppSummary[];
  workspaceApps: WorkspaceAppId[];
  templatesLoading?: boolean;
  connectedAppsLoading?: boolean;
  templatesError?: Error | null;
  connectedAppsError?: Error | null;
  onRetryTemplates?: () => void;
  onRetryConnectedApps?: () => void;
  templateLabels?: Partial<WorkspaceTemplateLabels>;
  onRemixSuccess?: (
    result: unknown,
    template: CuratedWorkspaceTemplate,
  ) => void;
  className?: string;
}) {
  const t = useT();
  const entries = mergeOtherAppEntries({
    templates,
    connectedApps,
    workspaceApps,
  });
  const isLoading = templatesLoading || connectedAppsLoading;
  const hasError = Boolean(templatesError || connectedAppsError);

  if (!isLoading && !hasError && entries.length === 0) return null;

  return (
    <section className={cn("space-y-3 border-t pt-6", className)}>
      <div className="flex min-w-0 items-start gap-2">
        <IconStack2
          size={16}
          className="mt-0.5 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-foreground">
            {t("dispatch.pages.otherApps", { defaultValue: "Other apps" })}
          </h2>
          {entries.length > 0 ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("dispatch.pages.availableCount", {
                count: entries.length,
              })}
            </p>
          ) : null}
        </div>
      </div>

      {templatesError ? (
        <ActionQueryError
          error={templatesError}
          onRetry={() => onRetryTemplates?.()}
        />
      ) : null}
      {connectedAppsError ? (
        <ActionQueryError
          error={connectedAppsError}
          onRetry={() => onRetryConnectedApps?.()}
        />
      ) : null}

      {isLoading && entries.length === 0 ? (
        <OtherAppsSkeletonList />
      ) : entries.length > 0 ? (
        <AppList className={APP_LIST_GRID_CLASS}>
          {entries.map((entry) =>
            entry.kind === "template" ? (
              <WorkspaceTemplateCard
                key={`template:${templateKey(entry.template)}`}
                template={entry.template}
                labels={templateLabels}
                catalog
                className={APP_LIST_GRID_ROW_CLASS}
                onRemixSuccess={onRemixSuccess}
              />
            ) : (
              <ConnectedAppCard
                key={`connected:${entry.app.id}`}
                app={entry.app}
                className={APP_LIST_GRID_ROW_CLASS}
              />
            ),
          )}
        </AppList>
      ) : null}
    </section>
  );
}

function OtherAppsSkeletonList() {
  return (
    <AppList className={APP_LIST_GRID_CLASS}>
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className={cn(
            "flex min-w-0 items-center gap-3 border-b px-4 py-3.5 last:border-b-0",
            APP_LIST_GRID_ROW_CLASS,
          )}
        >
          <Skeleton className="size-8 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <Skeleton className="h-9 w-24 shrink-0 rounded-md" />
        </div>
      ))}
    </AppList>
  );
}
