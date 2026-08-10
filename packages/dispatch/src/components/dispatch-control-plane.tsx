import {
  navigateWithAgentChatViewTransition,
  useChatModels,
} from "@agent-native/core/client/agent-chat";
import { PromptComposer } from "@agent-native/core/client/composer";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconChevronDown, IconClockHour4, IconPlus } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import type { ConnectedAppSummary } from "../lib/other-apps";
import { cn } from "../lib/utils";
import type { WorkspaceAppSummary } from "../lib/workspace-apps";
import { ActionQueryError } from "./action-query-error";
import {
  APP_LIST_GRID_CLASS,
  AppList,
  APP_LIST_GRID_ROW_CLASS,
} from "./app-list-row";
import { CreateAppPopover } from "./create-app-popover";
import { useSetPageTitle } from "./layout/HeaderActions";
import { mergeOtherAppEntries, OtherAppsSection } from "./other-apps-section";
import { Button } from "./ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { Skeleton } from "./ui/skeleton";
import { WorkspaceAppCard } from "./workspace-app-card";
import type { CuratedWorkspaceTemplatesResult } from "./workspace-template-card";

function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <h2 className="truncate text-sm font-semibold text-foreground">
        {title}
      </h2>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function CommandPanel() {
  const t = useT();
  const {
    availableModels,
    isLoading: modelListLoading,
    onEffortChange,
    onModelChange,
    selectedEffort,
    selectedEngine,
    selectedModel,
  } = useChatModels({ storageKey: "dispatch" });
  const navigate = useNavigate();
  const promptSuggestions = [
    t("dispatch.pages.suggestionWorkspaceHealth", {
      defaultValue: "Summarize the current workspace health",
    }),
    t("dispatch.pages.suggestionOnboardingApp", {
      defaultValue: "Create an app for onboarding requests",
    }),
    t("dispatch.pages.suggestionAnalyticsAgents", {
      defaultValue: "Check which agents can help with analytics",
    }),
  ];

  function send(message: string) {
    const trimmed = message.trim();
    if (!trimmed) return;

    navigateWithAgentChatViewTransition(navigate, "/chat", {
      state: {
        dispatchPrompt: {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          message: trimmed,
          selectedModel,
          selectedEngine,
          selectedEffort,
        },
      },
    });
  }

  return (
    <section className="flex flex-col">
      <div className="mx-auto flex w-full max-w-[750px] flex-col pt-4 sm:pt-6">
        <div className="mb-5 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {t("dispatch.pages.chatAcrossApps", {
              defaultValue: "Chat across your apps",
            })}
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            {t("dispatch.pages.chatAcrossAppsDescription", {
              defaultValue:
                "Route work, inspect status, or create something new from one place.",
            })}
          </p>
        </div>
        <PromptComposer
          availableModels={availableModels}
          modelListLoading={modelListLoading}
          placeholder={t("dispatch.pages.overviewPromptPlaceholder", {
            defaultValue: "Ask Dispatch anything...",
          })}
          selectedEffort={selectedEffort}
          selectedEngine={selectedEngine}
          selectedModel={selectedModel}
          onEffortChange={onEffortChange}
          onModelChange={onModelChange}
          onSubmit={(text) => send(text)}
        />
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {promptSuggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => send(suggestion)}
              className="cursor-pointer rounded-md border border-transparent bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground transition-[background-color,color] hover:bg-muted hover:text-foreground"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function AppsPanel({
  apps,
  isLoading,
  connectedApps,
  connectedAppsError,
  connectedAppsLoading,
  onRetryConnectedApps,
  curatedTemplates,
  curatedTemplatesError,
  curatedTemplatesLoading,
  onRetryCuratedTemplates,
}: {
  apps: WorkspaceAppSummary[];
  isLoading: boolean;
  connectedApps: ConnectedAppSummary[];
  connectedAppsError?: Error | null;
  connectedAppsLoading: boolean;
  onRetryConnectedApps: () => void;
  curatedTemplates?: CuratedWorkspaceTemplatesResult;
  curatedTemplatesError?: Error | null;
  curatedTemplatesLoading: boolean;
  onRetryCuratedTemplates: () => void;
}) {
  const t = useT();
  const [showPending, setShowPending] = useState(false);
  const visibleApps = apps.filter((app) => !app.isDispatch && !app.archived);
  const activeApps = visibleApps.filter((app) => app.status !== "pending");
  const pendingApps = visibleApps.filter((app) => app.status === "pending");
  const otherAppEntries = mergeOtherAppEntries({
    templates: curatedTemplates,
    connectedApps,
    workspaceApps: apps,
  });
  const showSkeletons =
    isLoading && activeApps.length === 0 && pendingApps.length === 0;

  return (
    <section className="mx-auto flex w-full max-w-[1000px] flex-col gap-3">
      <SectionHeader
        title="Apps"
        action={
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" asChild>
              <Link to="/apps">View all</Link>
            </Button>
            <CreateAppPopover
              align="end"
              trigger={
                <Button variant="ghost" size="sm" className="gap-1.5">
                  <IconPlus size={14} />
                  {t("dispatch.pages.newApp", { defaultValue: "New" })}
                </Button>
              }
            />
          </div>
        }
      />
      {showSkeletons ? (
        <OverviewAppsSkeleton />
      ) : (
        <>
          <AppList className={APP_LIST_GRID_CLASS}>
            {activeApps.map((app) => (
              <WorkspaceAppCard
                key={app.id}
                app={app}
                className={APP_LIST_GRID_ROW_CLASS}
              />
            ))}
            {activeApps.length === 0 &&
            otherAppEntries.length === 0 &&
            !curatedTemplatesLoading &&
            !connectedAppsLoading &&
            !curatedTemplatesError &&
            !connectedAppsError ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                {t("dispatch.pages.noApps", {
                  defaultValue: "No apps yet.",
                })}
              </p>
            ) : null}
            <OtherAppsSection
              templates={curatedTemplates}
              connectedApps={connectedApps}
              workspaceApps={apps}
              templatesLoading={curatedTemplatesLoading}
              connectedAppsLoading={connectedAppsLoading}
              templatesError={curatedTemplatesError}
              connectedAppsError={connectedAppsError}
              onRetryTemplates={onRetryCuratedTemplates}
              onRetryConnectedApps={onRetryConnectedApps}
              heading={null}
              embeddedInList
            />
          </AppList>
        </>
      )}
      {pendingApps.length > 0 ? (
        <Collapsible open={showPending} onOpenChange={setShowPending}>
          <div className="space-y-3 border-t pt-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <IconClockHour4
                  size={15}
                  className="shrink-0 text-muted-foreground"
                />
                <div className="min-w-0">
                  <h3 className="text-xs font-semibold text-foreground">
                    {t("dispatch.pages.pendingApps")}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {t("dispatch.pages.pendingAppsDescription", {
                      count: pendingApps.length,
                    })}
                  </p>
                </div>
              </div>
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs"
                >
                  {showPending
                    ? t("dispatch.pages.hidePendingApps")
                    : t("dispatch.pages.showPendingApps")}
                  <IconChevronDown
                    size={13}
                    className={showPending ? "rotate-180" : undefined}
                  />
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent>
              <AppList className={APP_LIST_GRID_CLASS}>
                {pendingApps.map((app) => (
                  <WorkspaceAppCard
                    key={app.id}
                    app={app}
                    className={APP_LIST_GRID_ROW_CLASS}
                  />
                ))}
              </AppList>
            </CollapsibleContent>
          </div>
        </Collapsible>
      ) : null}
    </section>
  );
}

function OverviewAppsSkeleton() {
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

export function DispatchControlPlane() {
  useSetPageTitle(<span aria-hidden />);
  const appsQuery = useActionQuery<WorkspaceAppSummary[]>(
    "list-workspace-apps",
    { includeAgentCards: false, includeArchived: true },
  );
  const connectedAppsQuery = useActionQuery<ConnectedAppSummary[]>(
    "list-connected-agents",
    {},
  );
  const curatedTemplatesQuery = useActionQuery<CuratedWorkspaceTemplatesResult>(
    "list-curated-workspace-templates",
    {},
  );
  const { data: workspaceApps = [], isLoading: appsLoading } = appsQuery;

  return (
    <div className="flex flex-col gap-8">
      <CommandPanel />
      {appsQuery.isError ? (
        <ActionQueryError
          error={appsQuery.error}
          onRetry={() => void appsQuery.refetch()}
        />
      ) : (
        <AppsPanel
          apps={workspaceApps ?? []}
          isLoading={appsLoading}
          connectedApps={connectedAppsQuery.data ?? []}
          connectedAppsError={connectedAppsQuery.error}
          connectedAppsLoading={connectedAppsQuery.isLoading}
          onRetryConnectedApps={() => void connectedAppsQuery.refetch()}
          curatedTemplates={curatedTemplatesQuery.data}
          curatedTemplatesError={curatedTemplatesQuery.error}
          curatedTemplatesLoading={curatedTemplatesQuery.isLoading}
          onRetryCuratedTemplates={() => void curatedTemplatesQuery.refetch()}
        />
      )}
    </div>
  );
}
