import { useChatModels } from "@agent-native/core/client/agent-chat";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { AgentToggleButton } from "@agent-native/core/client/agent-chat";
import { SettingsGroup, SettingsRow } from "@agent-native/core/client/settings";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconExternalLink,
  IconLoader2,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { FactoryAuditView } from "@/components/factory/FactoryAuditView";
import {
  FactoryCanvas,
  type FactoryCanvasEdge,
  type FactoryCanvasGraph,
  type FactoryCanvasNode,
} from "@/components/factory/FactoryCanvas";
import {
  FactoryInspector,
  type FactoryComment,
} from "@/components/factory/FactoryInspector";
import { TriageStatusPill } from "@/components/triage/triage-status-pill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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

type TriageDecision = {
  decisionId: string;
  summary?: string | null;
  reason?: string | null;
};

type TriageItem = {
  itemId?: string;
  id?: string;
  source?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  risk?: string | null;
  status?: string | null;
  coverage?: string | number | null;
  reason?: string | null;
  decisionSummary?: string | null;
  decisions?: TriageDecision[] | null;
};

type TriageRule = {
  id: string;
  name: string;
  promptText: string;
  mode: string;
  enabled: boolean;
  promptVersion: number;
};

type TriageConfig = {
  slackWorkspace?: "primary" | "secondary";
  slackChannelId?: string | null;
  slackChannelName?: string | null;
  pollingEnabled?: boolean;
  githubPollingEnabled?: boolean;
  sentryPollingEnabled?: boolean;
  sentryOrgSlug?: string | null;
  sentryProjectSlug?: string | null;
  sentryEnvironment?: string | null;
  repository?: string | null;
  automationFailureAlertsEnabled?: boolean;
  automationFailureAlertEmail?: string | null;
  emailReadiness?: {
    status: "ready" | "not-configured" | "misconfigured" | "unavailable";
    provider: string;
  };
};

type Verdict = "correct" | "incorrect" | "uncertain";
type WorkspaceTab =
  | "overview"
  | "map"
  | "inbox"
  | "rules"
  | "automations"
  | "audit"
  | "settings";

type FactoryAutomationRun = {
  id?: string;
  status?: string | null;
  startedAt?: string | number | null;
  finishedAt?: string | number | null;
  error?: string | null;
  runId?: string | null;
  threadId?: string | null;
};

type FactoryAutomationHealth = {
  status: "healthy" | "stale" | "error" | "no-data";
  lastCheckedAt?: number | null;
  lastDispatchedAt?: number | null;
  lastError?: string | null;
  runtime?: string | null;
};

type FactoryAutomation = {
  id: string;
  name: string;
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
  runs?: FactoryAutomationRun[] | null;
  pastRuns?: FactoryAutomationRun[] | null;
};

const DEFAULT_FACTORY_ID = "product-feedback";
const BLANK_FACTORY_GRAPH: FactoryCanvasGraph = {
  version: 1,
  name: "New factory",
  description: "Define the purpose, review flow, and handoff for this factory.",
  executionMode: "blueprint",
  nodes: [
    {
      id: "start",
      label: "Start",
      description: "Define the first decision or intake step for this factory.",
      kind: "decision",
      provider: "factory",
      position: { x: 240, y: 220 },
    },
  ],
  edges: [],
};

export function meta() {
  return [{ title: "Factory" }];
}

export default function FactoryRoute() {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseWorkspaceTab(searchParams.get("tab"));
  const selectedFactoryId = searchParams.get("factoryId");
  const factoryId = selectedFactoryId ?? DEFAULT_FACTORY_ID;
  const [creating, setCreating] = useState(false);
  const [draftGraph, setDraftGraph] = useState<FactoryCanvasGraph | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [auditRefreshToken, setAuditRefreshToken] = useState(0);

  function setActiveTab(tab: WorkspaceTab) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (tab === "overview") next.delete("tab");
        else next.set("tab", tab);
        return next;
      },
      { replace: true },
    );
  }

  function openFactory(
    nextFactoryId: string,
    options?: { tab?: WorkspaceTab; replace?: boolean },
  ) {
    setCreating(false);
    setDraftGraph(null);
    setDirty(false);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("factoryId", nextFactoryId);
        next.delete("node");
        next.delete("edge");
        next.delete("itemId");
        next.delete("automationId");
        next.delete("auditRunId");
        if (options?.tab) {
          if (options.tab === "overview") next.delete("tab");
          else next.set("tab", options.tab);
        }
        return next;
      },
      { replace: options?.replace ?? true },
    );
  }

  function goToFactoryList() {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("factoryId");
        next.delete("tab");
        next.delete("node");
        next.delete("edge");
        next.delete("itemId");
        next.delete("automationId");
        next.delete("auditRunId");
        return next;
      },
      { replace: true },
    );
  }

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
  const graphVersion = graphData?.factory.graphVersion ?? graph?.version ?? 1;
  const commentsQuery = useActionQuery(
    "list-factory-comments",
    { factoryId, graphVersion },
    { enabled: Boolean(selectedFactoryId && graph) },
  );
  const saveGraphMutation = useActionMutation("save-factory-graph");
  const addCommentMutation = useActionMutation("add-factory-comment");
  const factoryList = (factoryListQuery.data ?? []) as FactorySummary[];
  const comments = (commentsQuery.data ?? []) as FactoryComment[];

  useEffect(() => {
    if (!graphData || creating) return;
    setDraftGraph(graphData.graph);
    setDirty(false);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, [creating, graphData]);

  useEffect(() => {
    setSelectedNodeId(searchParams.get("node"));
    setSelectedEdgeId(searchParams.get("edge"));
  }, [searchParams]);

  useEffect(() => {
    if (selectedFactoryId) return;
    setCreating(false);
    setDraftGraph(null);
    setDirty(false);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, [selectedFactoryId]);

  const selectedNode = graph?.nodes.find((node) => node.id === selectedNodeId);
  const selectedEdge = graph?.edges.find((edge) => edge.id === selectedEdgeId);
  const commentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const comment of comments) {
      if (comment.targetId)
        counts[comment.targetId] = (counts[comment.targetId] ?? 0) + 1;
    }
    return counts;
  }, [comments]);

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

  function startNewFactory() {
    const id = `factory-${Date.now().toString(36)}`;
    openFactory(id, { tab: "overview" });
    setCreating(true);
    setDraftGraph(structuredClone(BLANK_FACTORY_GRAPH));
    setDirty(true);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }

  async function saveGraph() {
    if (!graph || !selectedFactoryId) return;
    await saveGraphMutation.mutateAsync({
      factoryId: selectedFactoryId,
      name: graph.name,
      description: graph.description,
      prompt: creating ? "" : (graphData?.factory.prompt ?? ""),
      source: "manual",
      changeSummary: creating
        ? "Created from the Factory visual editor."
        : "Updated in the Factory visual editor.",
      graph,
    });
    setCreating(false);
    setDirty(false);
    await Promise.all([graphQuery.refetch(), factoryListQuery.refetch()]);
  }

  async function addComment(
    targetType: "canvas" | "node" | "edge",
    targetId?: string,
    body?: string,
  ) {
    if (!body || !graph || !selectedFactoryId) return;
    await addCommentMutation.mutateAsync({
      factoryId: selectedFactoryId,
      graphVersion,
      targetType,
      ...(targetId ? { targetId } : {}),
      body,
    });
    await commentsQuery.refetch();
  }

  if (!selectedFactoryId) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background">
        <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 lg:p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                Factories
              </h1>
              <p className="text-sm leading-6 text-muted-foreground">
                Choose a factory to review its purpose, flow, automations, and
                recent activity. Start a new one from a minimal blank graph when
                you want to define a fresh review path.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" onClick={startNewFactory}>
                <IconPlus className="size-4" />
                New factory
              </Button>
              <AgentToggleButton />
            </div>
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
            <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={`factory-skeleton-${index}`}
                  className="grid gap-3 border-b border-border px-3 py-3 last:border-b-0 md:grid-cols-[minmax(0,2fr)_minmax(120px,0.8fr)_minmax(70px,auto)_auto] md:items-center"
                >
                  <div className="min-w-0 space-y-2">
                    <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
                  </div>
                  <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-12 animate-pulse rounded bg-muted" />
                  <div className="h-9 w-20 animate-pulse rounded bg-muted md:ms-auto" />
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
              {factoryList.map((factory) => (
                <div
                  key={factory.id}
                  className="group grid cursor-pointer gap-3 border-b border-border px-3 py-3 last:border-b-0 hover:bg-accent/25 md:grid-cols-[minmax(0,2fr)_minmax(120px,0.8fr)_minmax(70px,auto)_auto] md:items-center"
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    openFactory(factory.id, { tab: "overview" })
                  }
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    openFactory(factory.id, { tab: "overview" });
                  }}
                >
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-medium">
                      {factory.name}
                    </h2>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {factory.description || "No description yet."}
                    </p>
                  </div>
                  <div className="flex min-w-0 items-center text-xs text-muted-foreground">
                    {factory.virtual ? "Default factory" : "Saved factory"}
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
                        openFactory(factory.id, { tab: "overview" });
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
        <header className="shrink-0 border-b bg-background px-2 sm:px-4 lg:px-6">
          <div className="flex h-14 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1 sm:gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-10 shrink-0"
                onClick={goToFactoryList}
                aria-label="Back to factories"
              >
                <IconArrowLeft className="size-4" />
              </Button>
              <div className="h-5 w-48 animate-pulse rounded bg-muted" />
            </div>
            <div className="flex items-center gap-2">
              <div className="h-9 w-28 animate-pulse rounded bg-muted" />
              <AgentToggleButton />
            </div>
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
              <div className="h-[420px] animate-pulse rounded-xl border bg-muted/40" />
              <div className="h-[420px] animate-pulse rounded-xl border bg-muted/40" />
            </div>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b bg-background">
        <div className="flex h-14 items-center justify-between gap-3 px-2 sm:px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-1 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-10 shrink-0"
              onClick={goToFactoryList}
              aria-label="Back to factories"
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={startNewFactory}
            >
              <IconPlus className="size-4" />
              New factory
            </Button>
            <AgentToggleButton />
          </div>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto px-2 py-2 sm:px-4 lg:px-6">
          <nav
            className="flex min-w-0 flex-1 items-center gap-1"
            aria-label={t("factoryRoute.factoryViews")}
          >
            <TabButton
              active={activeTab === "overview"}
              onClick={() => setActiveTab("overview")}
            >
              Overview
            </TabButton>
            <TabButton
              active={activeTab === "map"}
              onClick={() => setActiveTab("map")}
            >
              Flow
            </TabButton>
            <TabButton
              active={activeTab === "inbox"}
              onClick={() => setActiveTab("inbox")}
            >
              Review
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
              Activity
            </TabButton>
            <TabButton
              active={activeTab === "settings"}
              onClick={() => setActiveTab("settings")}
            >
              Settings
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
            graphVersion={graphVersion}
            metrics={graphData?.metrics}
            onOpenReview={() => setActiveTab("inbox")}
            onOpenAutomations={() => setActiveTab("automations")}
            onOpenActivity={() => setActiveTab("audit")}
            onOpenSettings={() => setActiveTab("settings")}
            onOpenFlow={() => setActiveTab("map")}
          />
        ) : activeTab === "map" ? (
          <div className="grid min-h-full gap-0 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="min-w-0 p-4 lg:p-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs font-medium text-muted-foreground">
                  Flow
                </span>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Metric
                    label={t("factoryRoute.metricSignals")}
                    value={graphData?.metrics.totalItems ?? 0}
                  />
                  <Metric
                    label={t("factoryRoute.metricDecisions")}
                    value={graphData?.metrics.decisions ?? 0}
                  />
                  <Metric
                    label={t("factoryRoute.metricRuns")}
                    value={graphData?.metrics.runs ?? 0}
                  />
                </div>
              </div>
              <FactoryCanvas
                graph={graph}
                nodeMetrics={graphData?.nodeMetrics}
                commentCounts={commentCounts}
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
                onComment={addComment}
              />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>{t("factoryRoute.mapHint")}</span>
                {dirty && (
                  <span className="text-amber-700 dark:text-amber-300">
                    {t("factoryRoute.unsavedChanges")}
                  </span>
                )}
              </div>
            </section>
            <FactoryInspector
              graph={graph}
              selectedNode={selectedNode}
              selectedEdge={selectedEdge}
              comments={comments}
              factoryId={factoryId}
              dirty={dirty}
              saving={saveGraphMutation.isPending}
              onGraphChange={updateGraph}
              onSave={() => void saveGraph()}
              onAddComment={addComment}
              onAddNode={addNode}
              onDeleteNode={deleteNode}
              onConnect={connectNodes}
            />
          </div>
        ) : activeTab === "inbox" ? (
          <InboxView t={t} />
        ) : activeTab === "rules" ? (
          <RulesView t={t} />
        ) : activeTab === "automations" ? (
          <AutomationsView factoryId={factoryId} t={t} />
        ) : activeTab === "audit" ? (
          <FactoryAuditView
            factoryId={factoryId}
            refreshToken={auditRefreshToken}
          />
        ) : (
          <SettingsView t={t} />
        )}
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
  return value === "map" ||
    value === "inbox" ||
    value === "rules" ||
    value === "automations" ||
    value === "audit" ||
    value === "settings"
    ? value
    : "overview";
}

function OverviewView({
  graph,
  graphVersion,
  metrics,
  onOpenReview,
  onOpenAutomations,
  onOpenActivity,
  onOpenSettings,
  onOpenFlow,
}: {
  graph: FactoryCanvasGraph;
  graphVersion: number;
  metrics?: FactoryGraphResponse["metrics"];
  onOpenReview: () => void;
  onOpenAutomations: () => void;
  onOpenActivity: () => void;
  onOpenSettings: () => void;
  onOpenFlow: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 lg:p-6">
      <Card className="border-border/70">
        <CardHeader className="gap-4">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Overview
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-xl tracking-tight">
                {graph.name}
              </CardTitle>
              <span className="rounded-full border px-2 py-1 text-xs text-muted-foreground">
                Version {graphVersion}
              </span>
            </div>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              {graph.description || "No description yet."}
            </p>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardHeader className="gap-1 pb-2">
            <p className="text-sm text-muted-foreground">Signals</p>
            <CardTitle className="text-2xl">
              {(metrics?.totalItems ?? 0).toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            All observed items currently in scope.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="gap-1 pb-2">
            <p className="text-sm text-muted-foreground">Decisions</p>
            <CardTitle className="text-2xl">
              {(metrics?.decisions ?? 0).toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Review decisions captured through the factory flow.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="gap-1 pb-2">
            <p className="text-sm text-muted-foreground">Runs</p>
            <CardTitle className="text-2xl">
              {(metrics?.runs ?? 0).toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Approved automation or delivery runs for this workspace.
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">At a glance</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border bg-muted/30 px-3 py-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Nodes
              </p>
              <p className="mt-1 text-lg font-semibold">
                {graph.nodes.length.toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg border bg-muted/30 px-3 py-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Connections
              </p>
              <p className="mt-1 text-lg font-semibold">
                {graph.edges.length.toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg border bg-muted/30 px-3 py-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Completed runs
              </p>
              <p className="mt-1 text-lg font-semibold">
                {(metrics?.completedRuns ?? 0).toLocaleString()}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Open</CardTitle>
            <p className="text-sm text-muted-foreground">
              Jump into the part of this factory you want to work on next.
            </p>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Button
              type="button"
              variant="outline"
              className="justify-between"
              onClick={onOpenReview}
            >
              Review
            </Button>
            <Button
              type="button"
              variant="outline"
              className="justify-between"
              onClick={onOpenAutomations}
            >
              Automations
            </Button>
            <Button
              type="button"
              variant="outline"
              className="justify-between"
              onClick={onOpenActivity}
            >
              Activity
            </Button>
            <Button
              type="button"
              variant="outline"
              className="justify-between"
              onClick={onOpenSettings}
            >
              Settings
            </Button>
            <Button
              type="button"
              className="justify-between"
              onClick={onOpenFlow}
            >
              Edit flow
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-md border bg-card px-2.5 py-1.5">
      <span className="font-medium text-foreground">
        {value.toLocaleString()}
      </span>{" "}
      {label}
    </span>
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
  const selectedId = searchParams.get("automationId");
  const automationsQuery = useActionQuery<FactoryAutomation[]>(
    "list-factory-automations",
    { factoryId },
  );
  const saveMutation = useActionMutation("save-factory-automation");
  const runMutation = useActionMutation("run-factory-automation");
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

  function selectAutomation(id: string) {
    const nextAutomation = automations.find(
      (automation) => automation.id === id,
    );
    if (nextAutomation) setDraft(draftForAutomation(nextAutomation));
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("automationId", id);
        return next;
      },
      { replace: true },
    );
  }

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
        current.prompt === nextDraft.prompt &&
        current.body === nextDraft.body &&
        current.model === nextDraft.model &&
        current.schedule === nextDraft.schedule &&
        current.enabled === nextDraft.enabled
      ) {
        return current;
      }
      return nextDraft;
    });
  }, [selected, selectedId]);

  async function saveAutomation() {
    if (!draft) return;
    await saveMutation.mutateAsync({
      factoryId,
      automationId: draft.id,
      name: draft.name,
      prompt: draft.prompt ?? draft.body ?? "",
      model: draft.model ?? "",
      schedule: draft.schedule ?? "",
      enabled: draft.enabled,
    });
    await automationsQuery.refetch();
  }

  async function runAutomation() {
    if (!draft) return;
    await runMutation.mutateAsync({ factoryId, automationId: draft.id });
    await automationsQuery.refetch();
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(220px,.35fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("factoryRoute.automationsTitle")}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {t("factoryRoute.automationsDescription")}
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {automationsQuery.isLoading ? (
              <p className="p-4 text-sm text-muted-foreground">
                {t("factoryRoute.automationsLoading")}
              </p>
            ) : automations.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                {t("factoryRoute.automationsEmpty")}
              </p>
            ) : (
              <div
                className="divide-y"
                role="tablist"
                aria-label={t("factoryRoute.automationsTitle")}
              >
                {automations.map((automation) => (
                  <button
                    key={automation.id}
                    type="button"
                    id={`factory-automation-tab-${automation.id}`}
                    role="tab"
                    aria-selected={activeAutomationId === automation.id}
                    aria-controls="factory-automation-panel"
                    className={`w-full cursor-pointer p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${activeAutomationId === automation.id ? "bg-muted/60" : ""}`}
                    onClick={() => selectAutomation(automation.id)}
                  >
                    <span className="block truncate text-sm font-medium">
                      {automation.name}
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {automation.enabled
                        ? t("factoryRoute.automationEnabled")
                        : t("factoryRoute.automationDisabled")}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card
          id="factory-automation-panel"
          role="tabpanel"
          aria-labelledby={
            activeAutomationId
              ? `factory-automation-tab-${activeAutomationId}`
              : undefined
          }
        >
          <CardHeader className="border-b sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">
                {t("factoryRoute.automationEditorTitle")}
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("factoryRoute.automationEditorDescription")}
              </p>
            </div>
            {draft && (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void runAutomation()}
                  disabled={runMutation.isPending || draft.canUpdate === false}
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
                  disabled={saveMutation.isPending || draft.canUpdate === false}
                >
                  {saveMutation.isPending && (
                    <IconLoader2 className="animate-spin" />
                  )}
                  {t("factoryRoute.saveAutomation")}
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-5 pt-5">
            {!draft ? (
              <p className="text-sm text-muted-foreground">
                {t("factoryRoute.selectAutomation")}
              </p>
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="factory-automation-model">
                      {t("factoryRoute.automationModel")}
                    </Label>
                    <select
                      id="factory-automation-model"
                      value={draft.model ?? ""}
                      onChange={(event) =>
                        setDraft({ ...draft, model: event.target.value })
                      }
                      disabled={modelsLoading && modelOptions.length === 0}
                      className="h-9 rounded-md border bg-background px-3 text-sm"
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
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="factory-automation-schedule">
                      {t("factoryRoute.automationSchedule")}
                    </Label>
                    <Input
                      id="factory-automation-schedule"
                      value={draft.schedule ?? ""}
                      onChange={(event) =>
                        setDraft({ ...draft, schedule: event.target.value })
                      }
                      placeholder={t(
                        "factoryRoute.automationSchedulePlaceholder",
                      )}
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.enabled}
                    onCheckedChange={(checked) =>
                      setDraft({ ...draft, enabled: checked === true })
                    }
                    disabled={draft.canUpdate === false}
                  />
                  {t("factoryRoute.automationEnabledLabel")}
                </label>
                <div className="grid gap-2 rounded-md bg-muted/60 p-3 text-sm md:grid-cols-3">
                  <div>
                    <span className="block text-xs text-muted-foreground">
                      {t("factoryRoute.automationTrigger")}
                    </span>
                    <span>{draft.triggerType ?? "-"}</span>
                  </div>
                  <div>
                    <span className="block text-xs text-muted-foreground">
                      {t("factoryRoute.automationEvent")}
                    </span>
                    <span>{draft.event ?? "-"}</span>
                  </div>
                  <div>
                    <span className="block text-xs text-muted-foreground">
                      {t("factoryRoute.automationTimezone")}
                    </span>
                    <span>{draft.timezone ?? "-"}</span>
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label>{t("factoryRoute.automationPrompt")}</Label>
                  <Textarea
                    value={draft.prompt ?? draft.body ?? ""}
                    onChange={(event) =>
                      setDraft({ ...draft, prompt: event.target.value })
                    }
                    placeholder={t("factoryRoute.automationPromptPlaceholder")}
                    rows={12}
                  />
                  <p className="text-right text-xs text-muted-foreground">
                    {t("factoryRoute.promptEditorHint")}
                  </p>
                </div>
                <div className="border-t pt-5">
                  <h3 className="text-sm font-medium">
                    {t("factoryRoute.pastRuns")}
                  </h3>
                  {(draft.runs ?? draft.pastRuns ?? []).length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {t("factoryRoute.pastRunsEmpty")}
                    </p>
                  ) : (
                    <div className="mt-3 divide-y rounded-md border">
                      {(draft.runs ?? draft.pastRuns ?? []).map(
                        (run, index) => (
                          <div
                            key={run.id ?? `${draft.id}-run-${index}`}
                            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                          >
                            <span className="font-medium">
                              {run.status ?? "-"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatAutomationDate(run.startedAt)}
                            </span>
                            {run.threadId && (
                              <a
                                className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline"
                                href={`/chat/${encodeURIComponent(run.threadId)}`}
                              >
                                {t("factoryRoute.automationOpenThread")}
                                <IconExternalLink className="size-3" />
                              </a>
                            )}
                            {run.error && (
                              <span className="basis-full text-xs text-destructive">
                                {run.error}
                              </span>
                            )}
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
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

function InboxView({ t }: { t: ReturnType<typeof useT> }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("itemId"),
  );
  const [feedbackNote, setFeedbackNote] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const listQuery = useActionQuery("list-triage-items", {
    limit: 50,
    ...(status.trim()
      ? {
          status: status.trim() as
            | "received"
            | "context_fetching"
            | "evidence_ready"
            | "classified"
            | "shadow_decided"
            | "needs_manual"
            | "failed"
            | "reconciliation_required",
        }
      : {}),
  });
  const detailQuery = useActionQuery(
    "get-triage-item",
    selectedId ? { itemId: selectedId } : undefined,
    { enabled: Boolean(selectedId) },
  );
  const feedbackMutation = useActionMutation("record-triage-feedback");
  const approveMutation = useActionMutation("approve-factory-item");
  const items =
    (listQuery.data as { items?: TriageItem[] } | TriageItem[] | undefined) ??
    [];
  const normalizedItems = Array.isArray(items) ? items : (items.items ?? []);
  const selectedItem = detailQuery.data as TriageItem | undefined;

  useEffect(() => {
    setSelectedId(searchParams.get("itemId"));
  }, [searchParams]);

  function selectItem(itemId: string) {
    setSelectedId(itemId);
    setVerdict(null);
    setFeedbackNote("");
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("itemId", itemId);
        return next;
      },
      { replace: true },
    );
  }

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,.7fr)] lg:p-6">
      <Card>
        <CardHeader className="gap-3 border-b sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle className="text-base">Review</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Review incoming observations, inspect the latest decision, and
              approve the next step when it is ready.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="factory-status-filter">Status</Label>
              <Input
                id="factory-status-filter"
                className="h-8 w-36"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                placeholder={t("triage.statusPlaceholder")}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void listQuery.refetch()}
              disabled={listQuery.isFetching}
            >
              {listQuery.isFetching && <IconLoader2 className="animate-spin" />}
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {listQuery.isError ? (
            <ErrorState
              message="Could not load observations."
              onRetry={() => void listQuery.refetch()}
            />
          ) : listQuery.isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">
              {t("triage.loading")}
            </p>
          ) : normalizedItems.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {t("triage.empty")}
            </p>
          ) : (
            <div className="divide-y">
              {normalizedItems.map((item) => {
                const id = item.itemId ?? item.id ?? "";
                return (
                  <button
                    key={id}
                    type="button"
                    className={`grid w-full gap-3 p-4 text-left transition-colors hover:bg-muted/50 sm:grid-cols-[1.1fr_.7fr_.9fr_1.6fr] ${selectedId === id ? "bg-muted/60" : ""}`}
                    onClick={() => selectItem(id)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {item.sourceName ?? item.source ?? "Unknown source"}
                      </span>
                      {item.sourceUrl && (
                        <span className="mt-1 flex max-w-full items-center gap-1 truncate text-xs text-primary">
                          {item.sourceUrl}
                          <IconExternalLink className="size-3 shrink-0" />
                        </span>
                      )}
                    </span>
                    <span>
                      <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                        Risk
                      </span>
                      <TriageStatusPill status={item.risk} />
                    </span>
                    <span>
                      <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                        Status
                      </span>
                      <TriageStatusPill status={item.status} />
                    </span>
                    <span className="truncate">
                      <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                        Reason
                      </span>
                      <span className="text-sm">
                        {item.reason ?? item.decisionSummary ?? "-"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("triage.detailTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!selectedItem ? (
            <p className="text-sm text-muted-foreground">
              {t("factoryRoute.selectObservation")}
            </p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {selectedItem.sourceName ?? selectedItem.source}
                  </p>
                  {selectedItem.sourceUrl && (
                    <a
                      href={selectedItem.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      {t("triage.openSource")}
                      <IconExternalLink className="size-3" />
                    </a>
                  )}
                </div>
                <TriageStatusPill status={selectedItem.status} />
              </div>
              <Button
                size="sm"
                onClick={() => {
                  const decision =
                    selectedItem.decisions?.[
                      (selectedItem.decisions?.length ?? 1) - 1
                    ];
                  if (!decision) return;
                  approveMutation.mutate({
                    itemId: selectedItem.itemId ?? selectedItem.id ?? "",
                    decisionId: decision.decisionId,
                    confirm: true,
                  });
                }}
                disabled={
                  !selectedItem.decisions?.length || approveMutation.isPending
                }
              >
                <IconPlayerPlay className="size-4" />
                {t("factoryRoute.approveAndStart")}
              </Button>
              {selectedItem.decisionSummary && (
                <p className="rounded-md bg-muted px-3 py-2 text-sm">
                  {selectedItem.decisionSummary}
                </p>
              )}
              <div className="border-t pt-4">
                <p className="text-sm font-medium">{t("triage.decisions")}</p>
                {selectedItem.decisions?.length ? (
                  selectedItem.decisions.map((decision) => (
                    <div
                      key={decision.decisionId}
                      className="mt-3 space-y-3 rounded-md border p-3"
                    >
                      <p className="text-sm">
                        {decision.summary ?? decision.reason}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {(
                          ["correct", "incorrect", "uncertain"] as Verdict[]
                        ).map((value) => (
                          <Button
                            key={value}
                            size="sm"
                            variant={verdict === value ? "default" : "outline"}
                            onClick={() => setVerdict(value)}
                          >
                            {value}
                          </Button>
                        ))}
                      </div>
                      <Input
                        value={feedbackNote}
                        onChange={(event) =>
                          setFeedbackNote(event.target.value)
                        }
                        placeholder={t("triage.notePlaceholder")}
                      />
                      <Button
                        size="sm"
                        onClick={() => {
                          if (verdict)
                            feedbackMutation.mutate({
                              decisionId: decision.decisionId,
                              verdict,
                              ...(feedbackNote.trim()
                                ? { note: feedbackNote.trim() }
                                : {}),
                            });
                        }}
                        disabled={!verdict || feedbackMutation.isPending}
                      >
                        Record feedback
                      </Button>
                    </div>
                  ))
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t("triage.noDecisions")}
                  </p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RulesView({ t }: { t: ReturnType<typeof useT> }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const rulesQuery = useActionQuery("list-triage-rules", {});
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
          <CardTitle className="text-base">Rules</CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("factoryRoute.rulesDescription")}
          </p>
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
              <span className="text-xs text-muted-foreground">Shadow</span>
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
              Use prompts for classification; keep safety in structured guards.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="factory-rule-name">Name</Label>
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
            Save rule
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function SettingsView({ t }: { t: ReturnType<typeof useT> }) {
  const [workspace, setWorkspace] = useState<"primary" | "secondary">(
    "primary",
  );
  const [channelId, setChannelId] = useState("");
  const [channelName, setChannelName] = useState("");
  const [repository, setRepository] = useState("");
  const [polling, setPolling] = useState(false);
  const [githubPolling, setGithubPolling] = useState(false);
  const [sentryPolling, setSentryPolling] = useState(false);
  const [sentryOrgSlug, setSentryOrgSlug] = useState("");
  const [sentryProjectSlug, setSentryProjectSlug] = useState("");
  const [sentryEnvironment, setSentryEnvironment] = useState("");
  const [automationFailureAlertsEnabled, setAutomationFailureAlertsEnabled] =
    useState(true);
  const [automationFailureAlertEmail, setAutomationFailureAlertEmail] =
    useState("");
  const query = useActionQuery("get-triage-config", {});
  const schedulerHealthQuery = useActionQuery<FactoryAutomationHealth>(
    "get-factory-automation-health",
    {},
    { refetchInterval: 60_000 },
  );
  const mutation = useActionMutation("save-triage-config");

  useEffect(() => {
    const data = query.data as TriageConfig | undefined;
    if (!data) return;
    setWorkspace(data.slackWorkspace ?? "primary");
    setChannelId(data.slackChannelId ?? "");
    setChannelName(data.slackChannelName ?? "");
    setRepository(data.repository ?? "");
    setPolling(data.pollingEnabled ?? false);
    setGithubPolling(data.githubPollingEnabled ?? false);
    setSentryPolling(data.sentryPollingEnabled ?? false);
    setSentryOrgSlug(data.sentryOrgSlug ?? "");
    setSentryProjectSlug(data.sentryProjectSlug ?? "");
    setSentryEnvironment(data.sentryEnvironment ?? "");
    setAutomationFailureAlertsEnabled(
      data.automationFailureAlertsEnabled ?? true,
    );
    setAutomationFailureAlertEmail(data.automationFailureAlertEmail ?? "");
  }, [query.data]);

  const saveSettings = () => {
    mutation.mutate({
      slackWorkspace: workspace,
      slackChannelId: channelId,
      slackChannelName: channelName,
      repository,
      pollingEnabled: polling,
      githubPollingEnabled: githubPolling,
      sentryPollingEnabled: sentryPolling,
      sentryOrgSlug,
      sentryProjectSlug,
      sentryEnvironment,
      automationFailureAlertsEnabled,
      ...(automationFailureAlertEmail.trim()
        ? { automationFailureAlertEmail: automationFailureAlertEmail.trim() }
        : {}),
    });
  };

  const slackConfigured = Boolean(channelId.trim() || channelName.trim());
  const githubConfigured = Boolean(repository.trim());
  const sentryConfigured = Boolean(
    sentryOrgSlug.trim() || sentryProjectSlug.trim(),
  );

  if (query.isLoading) {
    return (
      <div className="w-full max-w-5xl space-y-6 p-4 lg:p-6">
        <FactorySettingsSkeleton />
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl space-y-6 p-4 lg:p-6">
      <SettingsGroup title="Sources">
        <SettingsRow
          label="Slack"
          status={
            slackConfigured ? (
              <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
                Connected
              </span>
            ) : undefined
          }
          control={
            <FactorySourcePopover
              label="Slack"
              connected={slackConfigured}
              saving={mutation.isPending}
              onSave={saveSettings}
            >
              <div className="grid gap-3">
                <label className="grid gap-1.5 text-xs font-medium text-foreground">
                  {t("triage.slackWorkspace")}
                  <select
                    aria-label={t("triage.slackWorkspace")}
                    value={workspace}
                    onChange={(event) =>
                      setWorkspace(event.target.value as "primary" | "secondary")
                    }
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="primary">primary</option>
                    <option value="secondary">secondary</option>
                  </select>
                </label>
                <label className="grid gap-1.5 text-xs font-medium text-foreground">
                  {t("triage.slackChannelId")}
                  <Input
                    aria-label={t("triage.slackChannelId")}
                    value={channelId}
                    onChange={(event) => setChannelId(event.target.value)}
                    placeholder={t("triage.slackChannelPlaceholder")}
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-medium text-foreground">
                  {t("triage.slackChannelName")}
                  <Input
                    aria-label={t("triage.slackChannelName")}
                    value={channelName}
                    onChange={(event) => setChannelName(event.target.value)}
                    placeholder={t("triage.slackChannelNamePlaceholder")}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-xs font-medium text-foreground">
                  {t("triage.enablePolling")}
                  <Checkbox
                    aria-label={t("triage.enablePolling")}
                    checked={polling}
                    onCheckedChange={(checked) => setPolling(checked === true)}
                  />
                </label>
              </div>
            </FactorySourcePopover>
          }
        />
        <SettingsRow
          label="GitHub"
          status={
            githubConfigured ? (
              <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
                Connected
              </span>
            ) : undefined
          }
          control={
            <FactorySourcePopover
              label="GitHub"
              connected={githubConfigured}
              saving={mutation.isPending}
              onSave={saveSettings}
            >
              <div className="grid gap-3">
                <label className="grid gap-1.5 text-xs font-medium text-foreground">
                  {t("triage.repository")}
                  <Input
                    aria-label={t("triage.repository")}
                    value={repository}
                    onChange={(event) => setRepository(event.target.value)}
                    placeholder={t("triage.repositoryPlaceholder")}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-xs font-medium text-foreground">
                  {t("triage.enableGithubPolling")}
                  <Checkbox
                    aria-label={t("triage.enableGithubPolling")}
                    checked={githubPolling}
                    onCheckedChange={(checked) =>
                      setGithubPolling(checked === true)
                    }
                  />
                </label>
              </div>
            </FactorySourcePopover>
          }
        />
        <SettingsRow
          label="Sentry"
          status={
            sentryConfigured ? (
              <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
                Connected
              </span>
            ) : undefined
          }
          control={
            <FactorySourcePopover
              label="Sentry"
              connected={sentryConfigured}
              saving={mutation.isPending}
              onSave={saveSettings}
            >
              <div className="grid gap-3">
                <label className="grid gap-1.5 text-xs font-medium text-foreground">
                  {t("triage.sentryOrgSlug")}
                  <Input
                    aria-label={t("triage.sentryOrgSlug")}
                    value={sentryOrgSlug}
                    onChange={(event) => setSentryOrgSlug(event.target.value)}
                    placeholder={t("triage.sentryOrgPlaceholder")}
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-medium text-foreground">
                  {t("triage.sentryProjectSlug")}
                  <Input
                    aria-label={t("triage.sentryProjectSlug")}
                    value={sentryProjectSlug}
                    onChange={(event) =>
                      setSentryProjectSlug(event.target.value)
                    }
                    placeholder={t("triage.sentryProjectPlaceholder")}
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-medium text-foreground">
                  {t("triage.sentryEnvironment")}
                  <Input
                    aria-label={t("triage.sentryEnvironment")}
                    value={sentryEnvironment}
                    onChange={(event) =>
                      setSentryEnvironment(event.target.value)
                    }
                    placeholder={t("triage.sentryEnvironmentPlaceholder")}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-xs font-medium text-foreground">
                  {t("triage.enableSentryPolling")}
                  <Checkbox
                    aria-label={t("triage.enableSentryPolling")}
                    checked={sentryPolling}
                    onCheckedChange={(checked) =>
                      setSentryPolling(checked === true)
                    }
                  />
                </label>
              </div>
            </FactorySourcePopover>
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t("factoryRoute.automationFailureAlertsTitle")}>
        <SettingsRow
          label={t("factoryRoute.automationFailureAlertsEnabled")}
          control={
            <Checkbox
              aria-label={t("factoryRoute.automationFailureAlertsEnabled")}
              checked={automationFailureAlertsEnabled}
              onCheckedChange={(checked) =>
                setAutomationFailureAlertsEnabled(checked === true)
              }
            />
          }
        />
        <SettingsRow
          label={t("factoryRoute.automationFailureAlertEmail")}
          control={
            <Input
              aria-label={t("factoryRoute.automationFailureAlertEmail")}
              type="email"
              value={automationFailureAlertEmail}
              onChange={(event) =>
                setAutomationFailureAlertEmail(event.target.value)
              }
              placeholder={t(
                "factoryRoute.automationFailureAlertEmailPlaceholder",
              )}
              className="h-9 w-full sm:w-64"
            />
          }
        />
        <SettingsRow
          label={t("factoryRoute.automationFailureEmailReadiness")}
          description={t("factoryRoute.automationEmailReadinessHint")}
          control={
            <span className="rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground">
              {(query.data as TriageConfig | undefined)?.emailReadiness
                ?.status ?? "unknown"}
            </span>
          }
        />
        {query.isError && (
          <div className="px-5 py-3 text-xs text-destructive sm:px-6">
            {t("factoryRoute.automationDiagnosticsLoadError")}{" "}
            {query.error instanceof Error
              ? query.error.message
              : String(query.error)}
          </div>
        )}
      </SettingsGroup>

      <div className="flex flex-wrap items-center justify-start gap-3">
        {mutation.isError && (
          <p className="text-sm text-destructive" role="alert">
            {t("triage.settingsError")}
          </p>
        )}
        {mutation.isSuccess && (
          <p className="text-sm text-muted-foreground" role="status">
            {t("triage.settingsSaved")}
          </p>
        )}
        <Button
          onClick={saveSettings}
          disabled={mutation.isPending}
        >
          {mutation.isPending && <IconLoader2 className="animate-spin" />}
          {t("triage.saveSettings")}
        </Button>
      </div>

      <SchedulerHealthStatus
        health={schedulerHealthQuery.data}
        isError={schedulerHealthQuery.isError}
        error={schedulerHealthQuery.error}
        t={t}
      />
    </div>
  );
}

function FactorySourcePopover({
  label,
  connected,
  saving,
  onSave,
  children,
}: {
  label: string;
  connected: boolean;
  saving: boolean;
  onSave: () => void;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant={connected ? "outline" : "default"}>
          {connected ? "Manage" : "Connect"}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[min(420px,calc(100vw-2rem))] p-4"
      >
        <div className="space-y-4">
          <p className="text-sm font-medium text-foreground">{label}</p>
          {children}
          <div className="flex justify-end">
            <Button type="button" onClick={onSave} disabled={saving}>
              {saving && <IconLoader2 className="animate-spin" />}
              {connected ? "Save" : "Connect"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FactorySettingsSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading factory settings">
      {Array.from({ length: 2 }).map((_, index) => (
        <div
          key={index}
          className="overflow-hidden rounded-xl border border-border/70 bg-card"
        >
          <div className="space-y-2 border-b border-border/60 px-5 py-4">
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
          </div>
          <div className="divide-y divide-border/60">
            {Array.from({ length: index === 0 ? 5 : 3 }).map((_, rowIndex) => (
              <div
                key={rowIndex}
                className="flex min-h-20 items-center justify-between gap-4 px-5 py-4 sm:px-6"
              >
                <div className="space-y-2">
                  <div className="h-3.5 w-36 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-48 animate-pulse rounded bg-muted" />
                </div>
                <div className="h-9 w-24 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
function SchedulerHealthStatus({
  health,
  isError,
  error,
  t,
}: {
  health?: FactoryAutomationHealth;
  isError: boolean;
  error: unknown;
  t: ReturnType<typeof useT>;
}) {
  const healthLabel = isError
    ? t("factoryRoute.automationHealthError")
    : health
      ? {
          healthy: t("factoryRoute.automationHealthHealthy"),
          stale: t("factoryRoute.automationHealthStale"),
          error: t("factoryRoute.automationHealthError"),
          "no-data": t("factoryRoute.automationHealthNoData"),
        }[health.status]
      : t("factoryRoute.automationHealthNoData");
  const hasNoHeartbeat =
    !isError &&
    (!health || health.status === "no-data") &&
    !health?.lastCheckedAt;
  const hasDiagnostics =
    isError ||
    hasNoHeartbeat ||
    health?.status === "stale" ||
    health?.status === "error" ||
    Boolean(health?.lastError);

  return (
    <section
      aria-labelledby="factory-scheduler-health"
      className="rounded-xl border border-border/70 bg-card px-5 py-4 text-card-foreground sm:px-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2
            id="factory-scheduler-health"
            className="text-sm font-medium text-muted-foreground"
          >
            {t("factoryRoute.automationHealthTitle")}
          </h2>
          <span className="rounded-full border px-2 py-0.5 text-xs font-medium">
            {healthLabel}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {health?.lastCheckedAt && (
            <span>
              {t("factoryRoute.automationLastCheck")}:{" "}
              {formatAutomationDate(health.lastCheckedAt)}
            </span>
          )}
          {health?.lastDispatchedAt && (
            <span>
              {t("factoryRoute.automationLastDispatch")}:{" "}
              {formatAutomationDate(health.lastDispatchedAt)}
            </span>
          )}
        </div>
      </div>
      {hasDiagnostics && (
        <div className="mt-2 grid gap-1 text-xs">
          {hasNoHeartbeat && (
            <p className="text-muted-foreground">
              {t("factoryRoute.automationHealthNoDataHint")}
            </p>
          )}
          {health?.status === "stale" && (
            <p className="text-destructive">
              {t("factoryRoute.automationHealthStaleHint")}
            </p>
          )}
          {health?.lastError && (
            <p className="text-destructive">
              {t("factoryRoute.automationHealthErrorDetail")}:{" "}
              {health.lastError}
            </p>
          )}
          {isError && (
            <p className="text-destructive">
              {t("factoryRoute.automationDiagnosticsLoadError")}{" "}
              {error instanceof Error ? error.message : String(error)}
            </p>
          )}
        </div>
      )}
    </section>
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
