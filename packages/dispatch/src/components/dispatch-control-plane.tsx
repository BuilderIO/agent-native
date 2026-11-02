import {
  chatModelSelectionStorageKey,
  navigateWithAgentChatViewTransition,
  useChatModels,
} from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { useOrgRole } from "@agent-native/core/client/org";
import {
  PromptBar,
  PromptComposer,
} from "@agent-native/toolkit/app/chat/composer/index";
import { IconChevronDown, IconClockHour4 } from "@tabler/icons-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import type { ConnectedAppSummary } from "../lib/other-apps";
import { cn } from "../lib/utils";
import {
  hasPinnedWorkspaceApp,
  orderWorkspaceApps,
  useWorkspaceAppLayout,
  workspaceAppMatchesQuery,
} from "../lib/workspace-app-layout";
import { useWorkspaceAppLists } from "../lib/workspace-app-lists";
import {
  isWorkspaceAppVisibleInDefaultLaunchers,
  type WorkspaceAppSummary,
} from "../lib/workspace-apps";
import { ActionQueryError } from "./action-query-error";
import { AppCardTiers } from "./app-card-tiers";
import { AppList, AppListRow } from "./app-list-row";
import { AppListActions, NoWorkspaceAppsText } from "./app-tier-sections";
import { NewAppButton } from "./create-app-popover";
import { useSetPageTitle } from "./layout/HeaderActions";
import { Button } from "./ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { Skeleton } from "./ui/skeleton";
import { WorkspaceAppCard } from "./workspace-app-card";
import {
  WorkspaceAppSearch,
  WorkspaceAppSearchEmpty,
} from "./workspace-app-search";

function CommandPanel() {
  const t = useT();
  const { org } = useOrgRole();
  const draftScope = org?.orgId?.trim()
    ? `dispatch:overview:${org.orgId}`
    : "dispatch:overview";
  const {
    availableModels,
    isLoading: modelListLoading,
    onEffortChange,
    onModelChange,
    selectedEffort,
    selectedEngine,
    selectedModel,
  } = useChatModels({ storageKey: chatModelSelectionStorageKey("dispatch") });
  const navigate = useNavigate();
  const promptSuggestions = [
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
        <PromptBar mode="inline" className="contents">
          <PromptComposer
            requireAgentEngine
            availableModels={availableModels}
            draftScope={draftScope}
            modelListLoading={modelListLoading}
            placeholder={t("dispatch.pages.overviewPromptPlaceholder", {
              defaultValue: "Ask Dispatch anything...",
            })}
            selectedEffort={selectedEffort}
            selectedEngine={selectedEngine}
            selectedModel={selectedModel}
            layoutVariant="hero"
            rootClassName="bg-card"
            onEffortChange={onEffortChange}
            onModelChange={onModelChange}
            onSubmit={(text) => send(text)}
          />
        </PromptBar>
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
  hostedApps,
  isLoading,
}: {
  apps: WorkspaceAppSummary[];
  hostedApps: ConnectedAppSummary[];
  isLoading: boolean;
}) {
  const t = useT();
  const [showPending, setShowPending] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { layout } = useWorkspaceAppLayout();
  const visibleApps = apps.filter(
    (app) => isWorkspaceAppVisibleInDefaultLaunchers(app) && !app.archived,
  );
  const activeApps = visibleApps.filter((app) => app.status !== "pending");
  const pendingApps = visibleApps.filter((app) => app.status === "pending");
  const filteredActiveApps = activeApps.filter((app) =>
    workspaceAppMatchesQuery(app, searchQuery),
  );
  const filteredPendingApps = orderWorkspaceApps(pendingApps, layout).filter(
    (app) => workspaceAppMatchesQuery(app, searchQuery),
  );
  const filteredHostedApps = hostedApps.filter((app) =>
    workspaceAppMatchesQuery(app, searchQuery),
  );
  const hasSearchResults =
    filteredActiveApps.length > 0 ||
    filteredPendingApps.length > 0 ||
    filteredHostedApps.length > 0;

  return (
    <section className="mx-auto flex w-full max-w-[1000px] flex-col gap-3">
      <AppCardTiers
        workspaceApps={isLoading ? [] : filteredActiveApps}
        hostedApps={isLoading ? [] : filteredHostedApps}
        appsTitle={t("dispatch.pages.workspaceApps")}
        hasPinnedApps={
          !isLoading &&
          hasPinnedWorkspaceApp([...activeApps, ...hostedApps], layout)
        }
        actions={
          <AppListActions
            viewAllHref="/apps"
            search={
              !isLoading &&
              (visibleApps.length > 0 ||
                hostedApps.length > 0 ||
                Boolean(searchQuery.trim())) ? (
                <WorkspaceAppSearch
                  className="w-full sm:w-[220px]"
                  query={searchQuery}
                  onQueryChange={setSearchQuery}
                />
              ) : undefined
            }
            newApp={<NewAppButton />}
          />
        }
        appsFallback={
          isLoading ? (
            <OverviewAppsSkeleton />
          ) : searchQuery.trim() ? (
            hasSearchResults ? null : (
              <WorkspaceAppSearchEmpty
                query={searchQuery}
                onClear={() => setSearchQuery("")}
              />
            )
          ) : activeApps.length === 0 && pendingApps.length === 0 ? (
            <NoWorkspaceAppsText />
          ) : null
        }
      />
      {pendingApps.length > 0 &&
      (!searchQuery.trim() || filteredPendingApps.length > 0) ? (
        <Collapsible
          open={showPending || Boolean(searchQuery.trim())}
          onOpenChange={setShowPending}
        >
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
                  {showPending || Boolean(searchQuery.trim())
                    ? t("dispatch.pages.hidePendingApps")
                    : t("dispatch.pages.showPendingApps")}
                  <IconChevronDown
                    size={13}
                    className={
                      showPending || searchQuery.trim()
                        ? "rotate-180"
                        : undefined
                    }
                  />
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent>
              <AppList layout="grid">
                {filteredPendingApps.map((app) => (
                  <WorkspaceAppCard key={app.id} app={app} />
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
    <AppList layout="grid">
      {Array.from({ length: 4 }).map((_, index) => (
        <AppListRow key={index}>
          <Skeleton className="size-8 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <Skeleton className="h-9 w-24 shrink-0 rounded-md" />
        </AppListRow>
      ))}
    </AppList>
  );
}

export function DispatchControlPlane() {
  useSetPageTitle(<span aria-hidden />);
  const {
    status: appsStatus,
    workspaceApps,
    hostedApps,
    appsQuery,
    connectedAppsQuery,
  } = useWorkspaceAppLists();

  return (
    <div className="flex flex-col gap-8">
      <CommandPanel />
      {appsStatus === "error" ? (
        <ActionQueryError
          error={appsQuery.error}
          onRetry={() => void appsQuery.refetch()}
          queryName="list-workspace-apps"
        />
      ) : (
        <>
          {appsQuery.isError ? (
            <ActionQueryError
              error={appsQuery.error}
              onRetry={() => void appsQuery.refetch()}
              queryName="list-workspace-apps"
            />
          ) : null}
          {connectedAppsQuery.isError ? (
            <ActionQueryError
              error={connectedAppsQuery.error}
              onRetry={() => void connectedAppsQuery.refetch()}
              queryName="list-connected-agents"
            />
          ) : null}
          <AppsPanel
            apps={workspaceApps}
            hostedApps={hostedApps}
            isLoading={appsStatus === "loading"}
          />
        </>
      )}
    </div>
  );
}
