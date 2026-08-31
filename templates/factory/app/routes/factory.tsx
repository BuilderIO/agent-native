import {
  requestAgentChatThreadOpen,
  useChatModels,
} from "@agent-native/core/client/agent-chat";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { SettingsGroup, SettingsRow } from "@agent-native/core/client/settings";
import { normalizeDocumentTitle } from "@agent-native/core/shared";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconLoader2,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import { CreateFactoryAutomationView } from "@/components/factory/CreateFactoryAutomationView";
import {
  canSaveFactoryAutomation,
  dispatchIntegrationsHref,
  emptyAutomationForm,
  formAuthorFilter,
  formatDailyTime,
  isDestinationReady,
  parseDailyTime,
  persistAuthorFilter,
  type AutomationAuthorMode,
  type AutomationSource,
  type FactoryAutomationConnections,
  type FactoryAutomationFormState,
} from "@/components/factory/factory-automation-form";
import { FactoryAgentsView } from "@/components/factory/FactoryAgentsView";
import { FactoryAuditView } from "@/components/factory/FactoryAuditView";
import { FactoryAutomationFields } from "@/components/factory/FactoryAutomationFields";
import {
  FactoryCanvas,
  type FactoryCanvasGraph,
  type FactoryCanvasNode,
} from "@/components/factory/FactoryCanvas";
import { FactoryHistoryView } from "@/components/factory/FactoryHistoryView";
import { FactoryInboxView } from "@/components/factory/FactoryInboxView";
import { FactoryInspector } from "@/components/factory/FactoryInspector";
import { FactorySettingsView } from "@/components/factory/FactorySettingsView";
import { FactoryWorkspaceActions } from "@/components/factory/FactoryWorkspaceActions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  factorySearchParamsEqual,
  retainFactoryTabParams,
  type WorkspaceTab,
} from "@/lib/factory-tab-params";

type FactoryGraphResponse = {
  factory: {
    id: string;
    name: string;
    description: string;
    prompt: string;
    graphVersion: number;
    virtual: boolean;
  };
  graph: FactoryCanvasGraph;
  metrics: {
    totalItems: number;
    slackItems: number;
    githubItems: number;
    decisions: number;
    manualItems: number;
    runs: number;
    completedRuns: number;
  };
  nodeMetrics: Record<string, number>;
};

type FactorySummary = {
  id: string;
  name: string;
  description: string;
  graphVersion: number;
  virtual?: boolean;
};

type TriageRule = {
  id: string;
  name: string;
  promptText: string;
  mode: string;
  enabled: boolean;
  promptVersion: number;
};

type FactoryAutomationRun = {
  id?: string;
  status?: string | null;
  startedAt?: string | number | null;
  finishedAt?: string | number | null;
  error?: string | null;
  runId?: string | null;
  threadId?: string | null;
};

type FactoryAutomation = {
  id: string;
  name: string;
  displayName: string;
  prompt?: string | null;
  body?: string | null;
  model?: string | null;
  schedule?: string | null;
  enabled: boolean;
  triggerType?: string | null;
  event?: string | null;
  timezone?: string | null;
  condition?: string | null;
  canUpdate?: boolean;
  updatedAt?: string | number | null;
  source?: AutomationSource;
  template?: FactoryAutomationFormState["template"];
  slackWorkspace?: "primary" | "secondary";
  slackChannelId?: string | null;
  slackChannelName?: string | null;
  repository?: string | null;
  sentryOrgSlug?: string | null;
  sentryProjectSlug?: string | null;
  sentryEnvironment?: string | null;
  authorMode?: AutomationAuthorMode;
  authorIds?: string[];
  scheduleMode?: FactoryAutomationFormState["scheduleMode"];
  intervalMinutes?: FactoryAutomationFormState["intervalMinutes"];
  dailyHour?: number;
  dailyMinute?: number;
  inboxLimit?: number;
  workLimit?: number;
  guardrails?: string;
  runs?: FactoryAutomationRun[] | null;
  pastRuns?: FactoryAutomationRun[] | null;
};

type RunFactoryAutomationResult = {
  queued: true;
  runId: string;
  automationRunId: string;
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
  const [draftGraph, setDraftGraph] = useState<FactoryCanvasGraph | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveConflictRemoteGraph, setSaveConflictRemoteGraph] =
    useState<FactoryCanvasGraph | null>(null);
  const [refreshingFactory, setRefreshingFactory] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [auditRefreshToken, setAuditRefreshToken] = useState(0);
  const draftRevisionRef = useRef(0);

  function setActiveTab(tab: WorkspaceTab) {
    setSearchParams((current) => retainFactoryTabParams(current, tab), {
      replace: true,
    });
  }

  function openFactory(
    nextFactoryId: string,
    options?: { tab?: WorkspaceTab; replace?: boolean },
  ) {
    const tab = options?.tab ?? "inbox";
    setDraftGraph(null);
    setDirty(false);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
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
  const graphQuery = useActionQuery(
    "get-factory-graph",
    selectedFactoryId ? { factoryId: selectedFactoryId } : undefined,
    { enabled: Boolean(selectedFactoryId) },
  );
  const rawGraphData = graphQuery.data as FactoryGraphResponse | undefined;
  const graphData =
    rawGraphData?.factory.id === factoryId ? rawGraphData : undefined;
  const graph = draftGraph ?? graphData?.graph ?? null;
  const graphVersion = graph?.version ?? graphData?.factory.graphVersion ?? 1;
  const saveGraphMutation = useActionMutation("save-factory-graph");
  const factoryList = (factoryListQuery.data ?? []) as FactorySummary[];
  const selectedFactory =
    graphData?.factory ??
    factoryList.find((factory) => factory.id === factoryId);

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

  useEffect(() => {
    if (!graphData || dirty) return;
    setDraftGraph(graphData.graph);
    setDirty(false);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, [dirty, graphData]);

  useEffect(() => {
    setSelectedNodeId(searchParams.get("node"));
    setSelectedEdgeId(searchParams.get("edge"));
  }, [searchParams]);

  useEffect(() => {
    if (selectedFactoryId) return;
    setDraftGraph(null);
    setDirty(false);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, [selectedFactoryId]);

  const selectedNode = graph?.nodes.find((node) => node.id === selectedNodeId);
  const selectedEdge = graph?.edges.find((edge) => edge.id === selectedEdgeId);

  function selectNode(nodeId: string) {
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("node", nodeId);
        next.delete("edge");
        return next;
      },
      { replace: true },
    );
  }

  function selectEdge(edgeId: string) {
    setSelectedEdgeId(edgeId);
    setSelectedNodeId(null);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("edge", edgeId);
        next.delete("node");
        return next;
      },
      { replace: true },
    );
  }

  function updateGraph(next: FactoryCanvasGraph) {
    draftRevisionRef.current += 1;
    setSaveError(null);
    setSaveConflictRemoteGraph(null);
    setDraftGraph(next);
    setDirty(
      !graphData?.graph ||
        JSON.stringify(next) !== JSON.stringify(graphData.graph),
    );
  }

  function addNode() {
    if (!graph) return;
    const id = `step-${Date.now().toString(36)}`;
    const nextNode: FactoryCanvasNode = {
      id,
      label: t("factoryRoute.newStep"),
      description: t("factoryRoute.newStepDescription"),
      kind: "decision",
      provider: "factory",
      position: { x: 560, y: 520 },
    };
    updateGraph({ ...graph, nodes: [...graph.nodes, nextNode] });
    selectNode(id);
  }

  function deleteNode(nodeId: string) {
    if (!graph || graph.nodes.length <= 1) return;
    updateGraph({
      ...graph,
      nodes: graph.nodes.filter((node) => node.id !== nodeId),
      edges: graph.edges.filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId,
      ),
    });
    setSelectedNodeId(null);
  }

  function connectNodes(sourceId: string, targetId: string) {
    if (!graph || sourceId === targetId) return;
    const alreadyConnected = graph.edges.some(
      (edge) => edge.source === sourceId && edge.target === targetId,
    );
    if (alreadyConnected) return;
    updateGraph({
      ...graph,
      edges: [
        ...graph.edges,
        {
          id: `route-${Date.now().toString(36)}`,
          source: sourceId,
          target: targetId,
          label: t("factoryRoute.newRoute"),
          condition: "",
        },
      ],
    });
  }

  async function saveGraph() {
    if (!graph || !selectedFactoryId) return;
    const submittedDraftRevision = draftRevisionRef.current;
    setSaveError(null);
    try {
      await saveGraphMutation.mutateAsync({
        factoryId: selectedFactoryId,
        name: graph.name,
        description: graph.description,
        prompt: graphData?.factory.prompt ?? "",
        source: "manual",
        changeSummary: "Updated in the Factory visual editor.",
        expectedGraphVersion: graph.version,
        graph,
      });
      setDirty(draftRevisionRef.current !== submittedDraftRevision);
      setSaveConflictRemoteGraph(null);
      await Promise.all([graphQuery.refetch(), factoryListQuery.refetch()]);
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : t("factoryRoute.saveConflictFallback"),
      );
    }
  }

  async function refreshFactoryAfterSaveConflict() {
    setRefreshingFactory(true);
    try {
      const results = await Promise.all([
        graphQuery.refetch(),
        factoryListQuery.refetch(),
      ]);
      if (results.some((result) => result.isError)) {
        throw new Error("Factory refresh failed.");
      }
      const remoteGraph = (results[0].data as FactoryGraphResponse | undefined)
        ?.graph;
      if (dirty) {
        if (!remoteGraph) throw new Error("Factory graph refresh failed.");
        setSaveConflictRemoteGraph(remoteGraph);
        setSaveError(t("factoryRoute.saveConflictFallback"));
        return;
      }
      setSaveError(null);
    } catch {
      setSaveError(t("factoryRoute.saveConflictFallback"));
    } finally {
      setRefreshingFactory(false);
    }
  }

  function discardLocalFactoryChanges() {
    if (!saveConflictRemoteGraph) return;
    setDraftGraph(saveConflictRemoteGraph);
    setSaveConflictRemoteGraph(null);
    setSaveError(null);
    setDirty(false);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }

  async function handleFactoryRestored(result?: { graph: FactoryCanvasGraph }) {
    if (result?.graph) setDraftGraph(result.graph);
    else setDraftGraph(null);
    setDirty(false);
    setSaveError(null);
    setSaveConflictRemoteGraph(null);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    const results = await Promise.all([
      graphQuery.refetch(),
      factoryListQuery.refetch(),
    ]);
    if (results.some((result) => result.isError)) {
      throw new Error("Factory view refresh failed.");
    }
  }

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
                  className="grid gap-3 rounded-xl bg-card px-3 py-3 shadow-sm md:grid-cols-[minmax(0,2fr)_minmax(120px,0.8fr)_minmax(70px,auto)_auto] md:items-center"
                >
                  <div className="min-w-0 space-y-2">
                    <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                  </div>
                  <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-12 animate-pulse rounded bg-muted" />
                  <div className="h-9 w-20 animate-pulse rounded bg-muted md:ms-auto" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid gap-2">
              {factoryList.map((factory) => (
                <div
                  key={factory.id}
                  className="group grid cursor-pointer gap-3 rounded-xl bg-card px-3 py-3 shadow-sm transition-colors hover:bg-accent/25 md:grid-cols-[minmax(0,2fr)_minmax(120px,0.8fr)_minmax(70px,auto)_auto] md:items-center"
                  role="button"
                  tabIndex={0}
                  onClick={() => openFactory(factory.id, { tab: "inbox" })}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    openFactory(factory.id, { tab: "inbox" });
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
                  <div className="text-xs text-muted-foreground">
                    v{factory.graphVersion}
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      className="md:opacity-0 md:transition-opacity md:group-hover:opacity-100"
                      onClick={(event) => {
                        event.stopPropagation();
                        openFactory(factory.id, { tab: "inbox" });
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

  if (!graph) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <header className="shrink-0 bg-background px-2 sm:px-4 lg:px-6">
          <div className="flex h-14 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1 sm:gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-10 shrink-0"
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
          {graphQuery.isError ? (
            <Card className="w-full max-w-lg">
              <CardContent className="p-0">
                <ErrorState
                  message="Could not load this factory."
                  onRetry={() => void graphQuery.refetch()}
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
              size="icon"
              className="size-10 shrink-0"
              onClick={goToFactoryList}
              aria-label={t("factoryRoute.backToFactories")}
            >
              <IconArrowLeft className="size-4" />
            </Button>
            <h1 className="truncate text-sm font-medium sm:text-base">
              {graph.name}
            </h1>
            <span className="shrink-0 text-xs text-muted-foreground">
              v{graphVersion}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <FactoryWorkspaceActions />
          </div>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto px-2 py-2 sm:px-4 lg:px-6">
          <nav
            className="flex min-w-0 flex-1 items-center gap-1"
            aria-label={t("factoryRoute.factoryViews")}
          >
            <TabButton
              active={activeTab === "inbox"}
              onClick={() => setActiveTab("inbox")}
            >
              {t("factoryRoute.inboxTab")}
            </TabButton>
            <TabButton
              active={activeTab === "rules"}
              onClick={() => setActiveTab("rules")}
            >
              {t("factoryRoute.rulesTab")}
            </TabButton>
            <TabButton
              active={activeTab === "automations"}
              onClick={() => setActiveTab("automations")}
            >
              {t("factoryRoute.automationsTab")}
            </TabButton>
            <TabButton
              active={activeTab === "audit"}
              onClick={() => setActiveTab("audit")}
            >
              {t("factoryRoute.auditTab")}
            </TabButton>
            <TabButton
              active={activeTab === "settings"}
              onClick={() => setActiveTab("settings")}
            >
              {t("factoryRoute.factorySettings")}
            </TabButton>
          </nav>
          {activeTab === "audit" && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={t("factoryRoute.auditRefresh")}
              title={t("factoryRoute.auditRefresh")}
              onClick={() => setAuditRefreshToken((current) => current + 1)}
            >
              <IconRefresh className="size-4" />
            </Button>
          )}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === "overview" ? (
          <OverviewView
            graph={graph}
            t={t}
            metrics={graphData?.metrics}
            nodeMetrics={graphData?.nodeMetrics}
            onOpenReview={() => setActiveTab("inbox")}
            onOpenAutomations={() => setActiveTab("automations")}
            onOpenActivity={() => setActiveTab("audit")}
            onOpenFlow={() => setActiveTab("map")}
            onOpenSettings={() => setActiveTab("settings")}
          />
        ) : activeTab === "map" ? (
          <div className="grid min-h-full gap-4 p-4 lg:p-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="min-w-0 rounded-xl bg-card p-4 shadow-sm lg:p-6">
              <FactoryCanvas
                graph={graph}
                nodeMetrics={graphData?.nodeMetrics}
                selectedNodeId={selectedNodeId}
                selectedEdgeId={selectedEdgeId}
                onSelectNode={selectNode}
                onSelectEdge={selectEdge}
                onMoveNode={(nodeId, position) => {
                  updateGraph({
                    ...graph,
                    nodes: graph.nodes.map((node) =>
                      node.id === nodeId ? { ...node, position } : node,
                    ),
                  });
                }}
              />
              {dirty && (
                <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
                  {t("factoryRoute.unsavedChanges")}
                </p>
              )}
            </section>
            <FactoryInspector
              graph={graph}
              selectedNode={selectedNode}
              selectedEdge={selectedEdge}
              factoryId={factoryId}
              dirty={dirty}
              saving={saveGraphMutation.isPending}
              saveError={saveError}
              saveConflictNeedsResolution={Boolean(saveConflictRemoteGraph)}
              refreshing={refreshingFactory}
              onGraphChange={updateGraph}
              onSave={() => void saveGraph()}
              onRefresh={refreshFactoryAfterSaveConflict}
              onDiscardLocalChanges={discardLocalFactoryChanges}
              onAddNode={addNode}
              onDeleteNode={deleteNode}
              onConnect={connectNodes}
            />
          </div>
        ) : activeTab === "inbox" ? (
          <FactoryInboxView
            key={factoryId}
            factoryId={factoryId}
            metrics={graphData?.metrics}
          />
        ) : activeTab === "rules" ? (
          <RulesView factoryId={factoryId} t={t} />
        ) : activeTab === "settings" ? (
          <FactorySettingsView
            key={factoryId}
            factoryId={factoryId}
            factoryName={graphData?.factory.name ?? graph.name}
            onDeleted={goToFactoryList}
          />
        ) : activeTab === "automations" ? (
          <AutomationsView key={factoryId} factoryId={factoryId} t={t} />
        ) : activeTab === "audit" ? (
          <FactoryAuditView
            factoryId={factoryId}
            refreshToken={auditRefreshToken}
          />
        ) : activeTab === "history" ? (
          <FactoryHistoryView
            key={factoryId}
            factoryId={factoryId}
            hasUnsavedChanges={dirty}
            onRestored={handleFactoryRestored}
          />
        ) : null}
      </main>
    </div>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm transition-colors ${active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function parseWorkspaceTab(value: string | null): WorkspaceTab {
  return value === "overview" ||
    value === "map" ||
    value === "inbox" ||
    value === "rules" ||
    value === "settings" ||
    value === "automations" ||
    value === "agents" ||
    value === "audit" ||
    value === "history"
    ? value
    : "inbox";
}

function OverviewView({
  graph,
  t,
  metrics,
  nodeMetrics,
  onOpenReview,
  onOpenAutomations,
  onOpenActivity,
  onOpenFlow,
  onOpenSettings,
}: {
  graph: FactoryCanvasGraph;
  t: ReturnType<typeof useT>;
  metrics?: FactoryGraphResponse["metrics"];
  nodeMetrics?: Record<string, number>;
  onOpenReview: () => void;
  onOpenAutomations: () => void;
  onOpenActivity: () => void;
  onOpenFlow: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 lg:p-6">
      <Card className="border-0 bg-muted/20 shadow-none">
        <CardHeader className="flex-row items-center justify-between gap-3 px-4 pb-0 pt-4">
          <CardTitle className="text-base">Flow</CardTitle>
          <Button type="button" variant="ghost" size="sm" onClick={onOpenFlow}>
            {t("factoryRoute.editFlow")}
          </Button>
        </CardHeader>
        <CardContent className="p-3">
          <FactoryCanvas graph={graph} nodeMetrics={nodeMetrics} preview />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <span>
              <span className="text-muted-foreground">Nodes </span>
              <span className="font-medium">
                {graph.nodes.length.toLocaleString()}
              </span>
            </span>
            <span>
              <span className="text-muted-foreground">Connections </span>
              <span className="font-medium">
                {graph.edges.length.toLocaleString()}
              </span>
            </span>
            <span>
              <span className="text-muted-foreground">
                {t("factoryRoute.auditRuns")}{" "}
              </span>
              <span className="font-medium">
                {(metrics?.completedRuns ?? 0).toLocaleString()}
              </span>
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={onOpenReview}>
              {t("factoryRoute.inboxTab")}
            </Button>
            <Button type="button" variant="outline" onClick={onOpenAutomations}>
              Automations
            </Button>
            <Button type="button" variant="outline" onClick={onOpenActivity}>
              {t("factoryRoute.auditTab")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenSettings?.()}
            >
              {t("factoryRoute.factorySettings")}
            </Button>
            <Button type="button" onClick={onOpenFlow}>
              {t("factoryRoute.editFlow")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AutomationsView({
  factoryId,
  t,
}: {
  factoryId: string;
  t: ReturnType<typeof useT>;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [draft, setDraft] = useState<FactoryAutomation | null>(null);
  const [queuedRuns, setQueuedRuns] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();
  useEffect(() => {
    setQueuedRuns({});
  }, [factoryId]);
  const selectedId = searchParams.get("automationId");
  const createOpen = searchParams.get("createAutomation") === "1";
  const automationsQuery = useActionQuery<FactoryAutomation[]>(
    "list-factory-automations",
    { factoryId },
    { refetchInterval: Object.keys(queuedRuns).length > 0 ? 1_000 : false },
  );
  const configQuery = useActionQuery<{
    connections?: FactoryAutomationConnections;
  }>("get-triage-config", { factoryId });
  const appsQuery = useActionQuery("list-workspace-apps", {
    includeAgentCards: false,
  });
  const workspaceIntegrationsHref = dispatchIntegrationsHref(appsQuery.data);
  const saveMutation = useActionMutation("save-factory-automation");
  const runMutation = useActionMutation<
    RunFactoryAutomationResult,
    { factoryId: string; automationId: string }
  >("run-factory-automation", { skipActionQueryInvalidation: true });
  const {
    availableModels,
    defaultModel,
    isLoading: modelsLoading,
  } = useChatModels({ storageKey: null });
  const response = automationsQuery.data;
  const automations = response ?? [];
  const selected =
    automations.find((automation) => automation.id === selectedId) ??
    automations[0] ??
    null;
  const modelOptions = useMemo(() => {
    const configuredGroups = availableModels.filter(
      (group) => group.configured,
    );
    const groups =
      configuredGroups.length > 0 ? configuredGroups : availableModels;
    const seen = new Set<string>();
    return groups.flatMap((group) =>
      group.models.flatMap((model) => {
        if (model === "auto" || seen.has(model)) return [];
        seen.add(model);
        return [
          { value: model, label: `${group.label} / ${formatModelName(model)}` },
        ];
      }),
    );
  }, [availableModels]);
  const autoModelLabel = `Auto (currently ${formatModelName(defaultModel)})`;
  const activeAutomationId = selected?.id ?? null;

  function draftForAutomation(automation: FactoryAutomation) {
    return { ...automation, model: automation.model?.trim() || "auto" };
  }

  function setCreateOpen(open: boolean) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (open) {
          next.set("createAutomation", "1");
          next.delete("automationId");
        } else {
          next.delete("createAutomation");
        }
        return next;
      },
      { replace: true },
    );
  }

  const selectAutomation = useCallback(
    (id: string) => {
      const nextAutomation = automations.find(
        (automation) => automation.id === id,
      );
      if (nextAutomation) setDraft(draftForAutomation(nextAutomation));
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("automationId", id);
          next.delete("createAutomation");
          return next;
        },
        { replace: true },
      );
    },
    [automations, setSearchParams],
  );

  useEffect(() => {
    if (!selected) {
      setDraft((current) => (current === null ? current : null));
      return;
    }
    if (selected.id !== selectedId) {
      selectAutomation(selected.id);
      return;
    }
    const nextDraft = draftForAutomation(selected);
    setDraft((current) => {
      if (
        current &&
        current.id === nextDraft.id &&
        current.name === nextDraft.name &&
        current.displayName === nextDraft.displayName &&
        current.prompt === nextDraft.prompt &&
        current.body === nextDraft.body &&
        current.model === nextDraft.model &&
        current.schedule === nextDraft.schedule &&
        current.enabled === nextDraft.enabled &&
        current.inboxLimit === nextDraft.inboxLimit &&
        current.workLimit === nextDraft.workLimit &&
        current.updatedAt === nextDraft.updatedAt
      ) {
        return current;
      }
      return nextDraft;
    });
  }, [selectAutomation, selected, selectedId]);

  useEffect(() => {
    if (Object.keys(queuedRuns).length === 0 || !response) return;
    const finishedAutomationIds = Object.entries(queuedRuns).flatMap(
      ([automationId, runId]) => {
        const automation = response.find((entry) => entry.id === automationId);
        const run = automation?.runs?.find((entry) => entry.id === runId);
        return run && run.status !== "running" ? [automationId] : [];
      },
    );
    if (finishedAutomationIds.length === 0) return;
    setQueuedRuns((current) => {
      const next = { ...current };
      for (const automationId of finishedAutomationIds) {
        delete next[automationId];
      }
      return next;
    });
    void queryClient.invalidateQueries({
      queryKey: ["action", "list-factory-audit"],
    });
  }, [queryClient, queuedRuns, response]);

  async function saveAutomation() {
    if (!draft) return;
    try {
      const daily = parseDailyTime(
        formatDailyTime(draft.dailyHour ?? 9, draft.dailyMinute ?? 0),
      );
      await saveMutation.mutateAsync({
        factoryId,
        automationId: draft.id,
        name: draft.name,
        displayName: draft.displayName,
        prompt: draft.prompt ?? draft.body ?? "",
        model: draft.model ?? "",
        enabled: draft.enabled,
        slackWorkspace: draft.slackWorkspace,
        slackChannelId: draft.slackChannelId ?? "",
        slackChannelName: draft.slackChannelName ?? "",
        repository: draft.repository ?? "",
        sentryOrgSlug: draft.sentryOrgSlug ?? "",
        sentryProjectSlug: draft.sentryProjectSlug ?? "",
        sentryEnvironment: draft.sentryEnvironment ?? "",
        authorMode: draft.authorMode,
        authorIds: draft.authorIds ?? [],
        scheduleMode: draft.scheduleMode,
        intervalMinutes: draft.intervalMinutes,
        dailyHour: daily.dailyHour,
        dailyMinute: daily.dailyMinute,
        timezone: draft.timezone ?? undefined,
        inboxLimit: draft.inboxLimit,
        workLimit: draft.workLimit,
      });
      await automationsQuery.refetch();
      toast.success(t("factoryRoute.automationSaved"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("factoryRoute.automationSaveFailed"),
      );
    }
  }

  async function runAutomation() {
    if (!draft) return;
    try {
      const result = await runMutation.mutateAsync({
        factoryId,
        automationId: draft.id,
      });
      setQueuedRuns((current) => ({
        ...current,
        [draft.id]: result.automationRunId,
      }));
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("auditRunId", result.automationRunId);
          return next;
        },
        { replace: true },
      );
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-factory-audit"],
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("factoryRoute.automationRunFailed"),
      );
    }
  }

  if (createOpen) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4 lg:p-6">
        <CreateFactoryAutomationView
          factoryId={factoryId}
          onCancel={() => setCreateOpen(false)}
          onCreated={(automationId) => {
            void automationsQuery.refetch();
            selectAutomation(automationId);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(220px,.35fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="text-base">
                {t("factoryRoute.automationsTitle")}
              </CardTitle>
              <Button
                type="button"
                size="sm"
                onClick={() => setCreateOpen(true)}
              >
                <IconPlus className="size-4" />
                {t("factoryRoute.createAutomation")}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {automationsQuery.isLoading ? (
              <p className="p-4 text-sm text-muted-foreground">
                {t("factoryRoute.automationsLoading")}
              </p>
            ) : automations.length === 0 ? (
              <div className="grid gap-3 p-4">
                <p className="text-sm text-muted-foreground">
                  {t("factoryRoute.automationsEmpty")}
                </p>
                <Button type="button" onClick={() => setCreateOpen(true)}>
                  {t("factoryRoute.createAutomation")}
                </Button>
              </div>
            ) : (
              <div
                className="grid gap-1.5 p-2"
                role="tablist"
                aria-label={t("factoryRoute.automationsTitle")}
              >
                {automations.map((automation) => {
                  const selected = activeAutomationId === automation.id;
                  const running = Boolean(queuedRuns[automation.id]);
                  return (
                    <button
                      key={automation.id}
                      type="button"
                      id={`factory-automation-tab-${automation.id}`}
                      role="tab"
                      aria-selected={selected}
                      aria-controls="factory-automation-panel"
                      className={`w-full cursor-pointer rounded-lg p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                        selected
                          ? "bg-primary/10 ring-1 ring-inset ring-primary/40"
                          : "bg-muted/20 hover:bg-muted/50"
                      }`}
                      onClick={() => selectAutomation(automation.id)}
                    >
                      <span
                        className="block break-words text-sm font-medium"
                        title={automation.name}
                      >
                        {automation.displayName}
                      </span>
                      <span className="mt-1 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                        {running ? (
                          <IconLoader2 className="size-3 animate-spin motion-reduce:animate-none" />
                        ) : (
                          <span
                            className={`size-1.5 shrink-0 rounded-full ${
                              automation.enabled
                                ? "bg-emerald-500"
                                : "bg-destructive"
                            }`}
                            aria-hidden
                          />
                        )}
                        {running
                          ? t("factoryRoute.automationRunning")
                          : automation.enabled
                            ? t("factoryRoute.automationEnabled")
                            : t("factoryRoute.automationDisabled")}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div
          id="factory-automation-panel"
          role="tabpanel"
          aria-labelledby={
            activeAutomationId
              ? `factory-automation-tab-${activeAutomationId}`
              : undefined
          }
          className="grid min-w-0 content-start gap-6"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">
              {t("factoryRoute.automationEditorTitle")}
            </h2>
            {draft ? (
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void runAutomation()}
                  disabled={
                    runMutation.isPending ||
                    Boolean(queuedRuns[draft.id]) ||
                    draft.canUpdate === false ||
                    !isDestinationReady(
                      draft.source ?? "slack",
                      configQuery.data?.connections,
                      draft.slackWorkspace ?? "primary",
                    )
                  }
                >
                  {runMutation.isPending && (
                    <IconLoader2 className="animate-spin" />
                  )}
                  <IconPlayerPlay className="size-4" />
                  {t("factoryRoute.runNow")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void saveAutomation()}
                  disabled={
                    saveMutation.isPending ||
                    draft.canUpdate === false ||
                    !canSaveFactoryAutomation(
                      automationToForm(draft),
                      configQuery.data?.connections,
                    )
                  }
                >
                  {saveMutation.isPending && (
                    <IconLoader2 className="animate-spin" />
                  )}
                  {t("factoryRoute.saveAutomation")}
                </Button>
              </div>
            ) : null}
          </div>
          {!draft ? (
            <p className="text-sm text-muted-foreground">
              {t("factoryRoute.selectAutomation")}
            </p>
          ) : (
            <>
              <FactoryAutomationFields
                form={automationToForm(draft)}
                connections={configQuery.data?.connections}
                readinessError={Boolean(configQuery.error)}
                workspaceIntegrationsHref={workspaceIntegrationsHref}
                onChange={(next) => {
                  const authors = persistAuthorFilter(
                    next.authorFilter,
                    next.authorIds,
                  );
                  setDraft({
                    ...draft,
                    displayName: next.displayName,
                    slackWorkspace: next.slackWorkspace,
                    slackChannelId: next.slackChannelId,
                    slackChannelName: next.slackChannelName,
                    repository: next.repository,
                    sentryOrgSlug: next.sentryOrgSlug,
                    sentryProjectSlug: next.sentryProjectSlug,
                    sentryEnvironment: next.sentryEnvironment,
                    authorMode: authors.authorMode,
                    authorIds: authors.authorIds,
                    scheduleMode: next.scheduleMode,
                    intervalMinutes: next.intervalMinutes,
                    dailyHour: parseDailyTime(next.dailyTime).dailyHour,
                    dailyMinute: parseDailyTime(next.dailyTime).dailyMinute,
                    timezone: next.timezone,
                    inboxLimit: next.inboxLimit,
                    workLimit: next.workLimit,
                    prompt: next.prompt,
                    enabled: next.enabled,
                  });
                }}
                showName
                showSource={false}
                showDestination
                showAuthors
                showSchedule
                showLimits
                showEnabled
                showGuardrails
                showPrompt
                guardrails={draft.guardrails ?? ""}
                disabled={draft.canUpdate === false}
                modelControl={
                  <SettingsRow
                    label={t("factoryRoute.automationModel")}
                    description={t("factoryRoute.automationModelDescription")}
                    control={
                      <select
                        id="factory-automation-model"
                        aria-label={t("factoryRoute.automationModel")}
                        value={draft.model ?? ""}
                        onChange={(event) =>
                          setDraft({ ...draft, model: event.target.value })
                        }
                        disabled={modelsLoading && modelOptions.length === 0}
                        className="h-9 w-full rounded-md border bg-card px-3 text-sm sm:w-64"
                      >
                        <option value="auto">{autoModelLabel}</option>
                        {draft.model &&
                          draft.model !== "auto" &&
                          !modelOptions.some(
                            (option) => option.value === draft.model,
                          ) && (
                            <option value={draft.model}>
                              Configured / {formatModelName(draft.model)}
                            </option>
                          )}
                        {modelOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    }
                  />
                }
              />
              <SettingsGroup variant="soft" title={t("factoryRoute.pastRuns")}>
                {(draft.runs ?? draft.pastRuns ?? []).length === 0 ? (
                  <SettingsRow label={t("factoryRoute.pastRunsEmpty")} />
                ) : (
                  (draft.runs ?? draft.pastRuns ?? []).map((run, index) => (
                    <SettingsRow
                      key={run.id ?? `${draft.id}-run-${index}`}
                      label={run.status ?? "-"}
                      description={run.error || undefined}
                      control={
                        <span className="text-sm text-muted-foreground">
                          {formatAutomationDate(run.startedAt)}
                        </span>
                      }
                    >
                      {run.threadId ? (
                        <a
                          className="inline-flex items-center text-xs text-muted-foreground underline-offset-4 hover:underline"
                          href={`/chat/${encodeURIComponent(run.threadId)}`}
                          onClick={(event) => {
                            if (
                              event.metaKey ||
                              event.ctrlKey ||
                              event.shiftKey ||
                              event.altKey ||
                              event.button !== 0
                            ) {
                              return;
                            }
                            event.preventDefault();
                            requestAgentChatThreadOpen({
                              threadId: run.threadId!,
                            });
                          }}
                        >
                          {t("factoryRoute.automationOpenThread")}
                        </a>
                      ) : null}
                    </SettingsRow>
                  ))
                )}
              </SettingsGroup>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function automationToForm(
  automation: FactoryAutomation,
): FactoryAutomationFormState {
  const source = automation.source ?? "slack";
  return {
    ...emptyAutomationForm(source),
    displayName: automation.displayName,
    source,
    template: automation.template ?? "blank",
    slackWorkspace: automation.slackWorkspace ?? "primary",
    slackChannelId: automation.slackChannelId ?? "",
    slackChannelName: automation.slackChannelName ?? "",
    repository: automation.repository ?? "",
    sentryOrgSlug: automation.sentryOrgSlug ?? "",
    sentryProjectSlug: automation.sentryProjectSlug ?? "",
    sentryEnvironment: automation.sentryEnvironment ?? "",
    authorFilter: formAuthorFilter(automation.authorMode, automation.authorIds),
    authorIds: automation.authorIds ?? [],
    scheduleMode: automation.scheduleMode ?? "interval",
    intervalMinutes: automation.intervalMinutes ?? 5,
    dailyTime: formatDailyTime(
      automation.dailyHour ?? 9,
      automation.dailyMinute ?? 0,
    ),
    timezone: automation.timezone ?? emptyAutomationForm().timezone,
    inboxLimit: automation.inboxLimit ?? 25,
    workLimit: automation.workLimit ?? (source === "slack" ? 5 : 3),
    prompt: automation.prompt ?? automation.body ?? "",
    enabled: automation.enabled,
  };
}

function formatAutomationDate(value: string | number | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function formatModelName(model: string | null | undefined) {
  const value = model?.trim();
  if (!value) return "the app default";
  const match = value.match(/^(?:openai\/)?gpt-5[.-]6[.-](sol|terra|luna)$/i);
  if (match) return `GPT-5.6 ${match[1][0].toUpperCase()}${match[1].slice(1)}`;
  return value
    .split(/[./_-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function RulesView({
  factoryId,
  t,
}: {
  factoryId: string;
  t: ReturnType<typeof useT>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const rulesQuery = useActionQuery("list-triage-rules", { factoryId });
  const saveMutation = useActionMutation("save-triage-rule");
  const rules = (rulesQuery.data ?? []) as TriageRule[];
  function selectRule(rule: TriageRule) {
    setEditingId(rule.id);
    setName(rule.name);
    setPrompt(rule.promptText);
  }
  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:p-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("factoryRoute.rulesTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => {
              setEditingId(null);
              setName("");
              setPrompt("");
            }}
          >
            <IconPlus className="size-4" />
            {t("triage.newRule")}
          </Button>
          {rules.map((rule) => (
            <Button
              key={rule.id}
              variant={editingId === rule.id ? "secondary" : "ghost"}
              className="h-auto w-full justify-between gap-2 px-3 py-2 text-left"
              onClick={() => selectRule(rule)}
            >
              <span className="min-w-0 truncate">{rule.name}</span>
              <span className="text-xs text-muted-foreground">
                {t("factoryRoute.shadowLabel")}
              </span>
            </Button>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              {t("factoryRoute.editRule")}
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("factoryRoute.rulesGuidance")}
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="factory-rule-name">
              {t("factoryRoute.ruleNameLabel")}
            </Label>
            <Input
              id="factory-rule-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("triage.ruleNamePlaceholder")}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="factory-rule-prompt">
              {t("triage.rulePrompt")}
            </Label>
            <Textarea
              id="factory-rule-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={8}
              placeholder={t("triage.rulePromptPlaceholder")}
            />
          </div>
          <div className="rounded-lg bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
            {t("triage.hardGuards")}
          </div>
          <Button
            onClick={() => {
              if (!name.trim() || !prompt.trim()) return;
              saveMutation.mutate({
                factoryId,
                ...(editingId ? { id: editingId } : {}),
                name,
                description: "",
                promptText: prompt,
                mode: "shadow",
                enabled: true,
              });
            }}
            disabled={!name.trim() || !prompt.trim() || saveMutation.isPending}
          >
            {saveMutation.isPending && <IconLoader2 className="animate-spin" />}
            {t("factoryRoute.saveRule")}
          </Button>
        </CardContent>
      </Card>
    </div>
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
