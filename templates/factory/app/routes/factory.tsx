import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { normalizeDocumentTitle } from "@agent-native/core/shared";
import { IconAlertCircle, IconArrowLeft } from "@tabler/icons-react";
import { useEffect } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";

import { FactoryAgentsView } from "@/components/factory/FactoryAgentsView";
import { FactoryWorkspaceActions } from "@/components/factory/FactoryWorkspaceActions";
import { SettingsView } from "@/components/factory/SettingsView";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ActivityView } from "@/components/workflow/ActivityView";
import { ItemsView } from "@/components/workflow/ItemsView";
import { WorkflowPage } from "@/components/workflow/WorkflowPage";
import { WorkflowsView } from "@/components/workflow/WorkflowsView";
import {
  DEFAULT_WORKSPACE_TAB,
  factorySearchParamsEqual,
  factoryUrlForTab,
  factoryWorkflowUrl,
  parseWorkspaceTab,
  retainFactoryTabParams,
  type WorkspaceTab,
} from "@/lib/factory-tab-params";
import { cn } from "@/lib/utils";

type FactorySummary = {
  id: string;
  name: string;
  description: string;
  virtual?: boolean;
};

const DEFAULT_FACTORY_ID = "product-feedback";

export function meta() {
  return [{ title: "Factory" }];
}

export default function FactoryRoute() {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseWorkspaceTab(searchParams.get("tab"));
  const selectedFactoryId = searchParams.get("factoryId");
  const factoryId = selectedFactoryId ?? DEFAULT_FACTORY_ID;
  const navigate = useNavigate();
  const workflowId =
    activeTab === "workflows" ? searchParams.get("workflow") : null;

  function openWorkflow(
    openId: string,
    nodeId?: string,
    target?: { runId?: string; version?: number },
  ): void {
    navigate(
      factoryWorkflowUrl(factoryId, {
        workflowId: openId,
        nodeId,
        runId: target?.runId,
        version: target?.version,
      }),
    );
  }

  function openFactory(
    nextFactoryId: string,
    options?: { tab?: WorkspaceTab; replace?: boolean },
  ) {
    const tab = options?.tab ?? DEFAULT_WORKSPACE_TAB;
    setSearchParams(
      () => {
        const next = retainFactoryTabParams(new URLSearchParams(), tab);
        next.set("factoryId", nextFactoryId);
        return next;
      },
      { replace: options?.replace ?? true },
    );
  }

  function goToFactoryList() {
    setSearchParams(new URLSearchParams(), { replace: true });
  }

  useEffect(() => {
    setSearchParams(
      (current) => {
        const next = retainFactoryTabParams(current, activeTab);
        return factorySearchParamsEqual(current, next) ? current : next;
      },
      { replace: true },
    );
  }, [activeTab, setSearchParams]);

  const factoryListQuery = useActionQuery("list-factories", {});
  const factoryList = (factoryListQuery.data ?? []) as FactorySummary[];
  const selectedFactory = factoryList.find(
    (factory) => factory.id === factoryId,
  );

  useEffect(() => {
    if (!selectedFactory?.name) return;
    const nextTitle = `${normalizeDocumentTitle(
      selectedFactory.name,
      "Factory",
    )} — Factory`;
    const previousTitle = document.title;
    document.title = nextTitle;
    return () => {
      if (document.title === nextTitle) document.title = previousTitle;
    };
  }, [selectedFactory?.name]);

  if (searchParams.get("new") === "1") {
    return <Navigate to="/new-factory" replace />;
  }

  if (selectedFactoryId && searchParams.get("tab") === "agents") {
    return <Navigate to="/factory?tab=agents" replace />;
  }

  if (!selectedFactoryId && activeTab === "agents") {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background">
        <div className="flex items-center gap-3 px-4 py-4 lg:px-6">
          <Button asChild type="button" variant="ghost" size="icon">
            <Link to="/factory" aria-label={t("factoryRoute.backToFactories")}>
              <IconArrowLeft className="size-4" />
            </Link>
          </Button>
          <h1 className="text-sm font-medium sm:text-base">
            {t("factoryRoute.agentsTitle")}
          </h1>
          <div className="ms-auto">
            <FactoryWorkspaceActions />
          </div>
        </div>
        <FactoryAgentsView />
      </div>
    );
  }

  // An open workflow takes the whole page: its own toolbar replaces the factory header.
  if (selectedFactoryId && workflowId) {
    return (
      <WorkflowPage
        factoryId={factoryId}
        workflowId={workflowId}
        backHref={factoryUrlForTab(factoryId, "workflows")}
      />
    );
  }

  if (!selectedFactoryId) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background">
        <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 lg:p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h1 className="text-2xl font-semibold tracking-tight">Factories</h1>
            <FactoryWorkspaceActions />
          </div>

          {factoryListQuery.isError ? (
            <Card>
              <CardContent className="p-0">
                <ErrorState
                  message="Could not load factories."
                  onRetry={() => void factoryListQuery.refetch()}
                />
              </CardContent>
            </Card>
          ) : factoryListQuery.isLoading ? (
            <div className="grid gap-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={`factory-skeleton-${index}`}
                  className="grid gap-3 rounded-xl bg-card px-3 py-3 shadow-sm md:grid-cols-[minmax(0,2fr)_minmax(120px,0.8fr)_auto] md:items-center"
                >
                  <div className="min-w-0 space-y-2">
                    <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                  </div>
                  <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                  <div className="h-9 w-20 animate-pulse rounded bg-muted md:ms-auto" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid gap-2">
              {factoryList.map((factory) => (
                <div
                  key={factory.id}
                  className="group grid cursor-pointer gap-3 rounded-xl bg-card px-3 py-3 shadow-sm transition-colors hover:bg-accent/25 md:grid-cols-[minmax(0,2fr)_minmax(120px,0.8fr)_auto] md:items-center"
                  role="button"
                  tabIndex={0}
                  onClick={() => openFactory(factory.id)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    openFactory(factory.id);
                  }}
                >
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-medium">
                      {factory.name}
                    </h2>
                  </div>
                  <div className="flex min-w-0 items-center text-xs text-muted-foreground">
                    {factory.virtual
                      ? t("factoryRoute.defaultFactoryLabel")
                      : t("factoryRoute.savedFactoryLabel")}
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      className="md:opacity-0 md:transition-opacity md:group-hover:opacity-100"
                      onClick={(event) => {
                        event.stopPropagation();
                        openFactory(factory.id);
                      }}
                    >
                      Open
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  if (!selectedFactory) {
    const pending = factoryListQuery.isFetching;
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <header className="shrink-0 bg-background px-2 sm:px-4 lg:px-6">
          <div className="flex h-14 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1 sm:gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                className="shrink-0"
                onClick={goToFactoryList}
                aria-label={t("factoryRoute.backToFactories")}
              >
                <IconArrowLeft className="size-4" />
              </Button>
              <div className="h-5 w-48 animate-pulse rounded bg-muted" />
            </div>
            <FactoryWorkspaceActions />
          </div>
        </header>
        <main className="flex flex-1 items-center justify-center p-6">
          {!pending ? (
            <Card className="w-full max-w-lg">
              <CardContent className="p-0">
                <ErrorState
                  message="Could not load this factory."
                  onRetry={() => void factoryListQuery.refetch()}
                />
              </CardContent>
            </Card>
          ) : (
            <div className="grid w-full max-w-5xl gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="h-[420px] animate-pulse rounded-xl bg-card shadow-sm" />
              <div className="h-[420px] animate-pulse rounded-xl bg-card shadow-sm" />
            </div>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header className="shrink-0 bg-background">
        <div className="flex h-14 items-center justify-between gap-3 px-2 sm:px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-1 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              className="shrink-0"
              onClick={goToFactoryList}
              aria-label={t("factoryRoute.backToFactories")}
            >
              <IconArrowLeft className="size-4" />
            </Button>
            <h1 className="truncate text-sm font-medium sm:text-base">
              {selectedFactory.name}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <FactoryWorkspaceActions />
          </div>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto px-2 py-2 sm:px-4 lg:px-6">
          <nav
            className="flex min-w-0 flex-1 items-center gap-1"
            aria-label={t("workflows.tabs.navLabel")}
          >
            <TabLink factoryId={factoryId} tab="workflows" active={activeTab}>
              {t("workflows.tabs.workflows")}
            </TabLink>
            <TabLink factoryId={factoryId} tab="items" active={activeTab}>
              {t("workflows.tabs.items")}
            </TabLink>
            <TabLink factoryId={factoryId} tab="activity" active={activeTab}>
              {t("workflows.tabs.activity")}
            </TabLink>
            <TabLink factoryId={factoryId} tab="settings" active={activeTab}>
              {t("workflows.tabs.settings")}
            </TabLink>
          </nav>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === "workflows" ? (
          <WorkflowsView key={factoryId} factoryId={factoryId} />
        ) : activeTab === "items" ? (
          <ItemsView
            key={factoryId}
            factoryId={factoryId}
            onOpenWorkflow={openWorkflow}
          />
        ) : activeTab === "activity" ? (
          <ActivityView
            key={factoryId}
            factoryId={factoryId}
            onOpenWorkflow={openWorkflow}
          />
        ) : activeTab === "settings" ? (
          <SettingsView
            key={factoryId}
            factoryId={factoryId}
            factoryName={selectedFactory.name}
            deletable={factoryId !== DEFAULT_FACTORY_ID}
            onDeleted={goToFactoryList}
          />
        ) : null}
      </main>
    </div>
  );
}

function TabLink({
  factoryId,
  tab,
  active,
  children,
}: {
  factoryId: string;
  tab: WorkspaceTab;
  active: WorkspaceTab;
  children: React.ReactNode;
}) {
  const current = active === tab;
  return (
    <Link
      to={factoryUrlForTab(factoryId, tab)}
      replace
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm transition-colors",
        current
          ? "bg-muted font-medium text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
      aria-current={current ? "page" : undefined}
    >
      {children}
    </Link>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center gap-2 p-4 text-sm text-destructive">
      <IconAlertCircle className="size-4 shrink-0" />
      <span>{message}</span>
      <Button variant="link" size="sm" className="h-auto p-0" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
