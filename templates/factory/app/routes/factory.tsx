import { useChatModels } from "@agent-native/core/client/agent-chat";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertCircle,
  IconExternalLink,
  IconLoader2,
  IconPlayerPlay,
  IconPlus,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

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
};

type Verdict = "correct" | "incorrect" | "uncertain";
type WorkspaceTab = "map" | "inbox" | "rules" | "automations" | "settings";

type FactoryAutomationRun = {
  id?: string;
  status?: string | null;
  startedAt?: string | number | null;
  finishedAt?: string | number | null;
  error?: string | null;
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

export function meta() {
  return [{ title: "Factory" }];
}

export default function FactoryRoute() {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseWorkspaceTab(searchParams.get("tab"));
  const factoryId = searchParams.get("factoryId") || DEFAULT_FACTORY_ID;
  const [creating, setCreating] = useState(false);
  const [draftGraph, setDraftGraph] = useState<FactoryCanvasGraph | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  function setActiveTab(tab: WorkspaceTab) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (tab === "map") next.delete("tab");
        else next.set("tab", tab);
        return next;
      },
      { replace: true },
    );
  }

  function setFactoryId(nextFactoryId: string) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (nextFactoryId === DEFAULT_FACTORY_ID) next.delete("factoryId");
        else next.set("factoryId", nextFactoryId);
        return next;
      },
      { replace: true },
    );
  }

  const factoryListQuery = useActionQuery("list-factories", {});
  const graphQuery = useActionQuery("get-factory-graph", { factoryId });
  const graphData = graphQuery.data as FactoryGraphResponse | undefined;
  const graph = draftGraph ?? graphData?.graph ?? null;
  const graphVersion = graphData?.factory.graphVersion ?? graph?.version ?? 1;
  const commentsQuery = useActionQuery(
    "list-factory-comments",
    { factoryId, graphVersion },
    { enabled: Boolean(graph) },
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
    setDirty(true);
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
    const base = graph ?? graphData?.graph;
    if (!base) return;
    const id = `factory-${Date.now().toString(36)}`;
    setFactoryId(id);
    setCreating(true);
    setDraftGraph({
      ...structuredClone(base),
      version: 1,
      name: t("factoryRoute.newFactory"),
      description: t("factoryRoute.newFactoryDescription"),
    });
    setDirty(true);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setActiveTab("map");
  }

  async function saveGraph() {
    if (!graph) return;
    await saveGraphMutation.mutateAsync({
      factoryId,
      name: graph.name,
      description: graph.description,
      prompt: graphData?.factory.prompt ?? "",
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
    if (!body || !graph) return;
    await addCommentMutation.mutateAsync({
      factoryId,
      graphVersion,
      targetType,
      ...(targetId ? { targetId } : {}),
      body,
    });
    await commentsQuery.refetch();
  }

  if (!graph) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
        {graphQuery.isError
          ? "Could not load this Factory."
          : "Loading Factory..."}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b bg-background px-4 py-2.5 lg:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-semibold">{graph.name}</h1>
              <span className="shrink-0 text-xs text-muted-foreground">
                v{graphVersion}
              </span>
            </div>
            <p className="hidden truncate text-xs text-muted-foreground md:block">
              {graph.description}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              aria-label={t("factoryRoute.selectFactory")}
              value={factoryId}
              onChange={(event) => {
                setFactoryId(event.target.value);
                setCreating(false);
                setDraftGraph(null);
                setDirty(false);
              }}
              className="h-9 max-w-[220px] rounded-md border bg-background px-3 text-sm"
            >
              {factoryList.map((factory) => (
                <option key={factory.id} value={factory.id}>
                  {factory.name}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={startNewFactory}
            >
              <IconPlus className="size-4" />
              New
            </Button>
          </div>
        </div>
        <nav
          className="mt-4 flex items-center gap-1 overflow-x-auto"
          aria-label={t("factoryRoute.factoryViews")}
        >
          <TabButton
            active={activeTab === "map"}
            onClick={() => setActiveTab("map")}
          >
            Map
          </TabButton>
          <TabButton
            active={activeTab === "inbox"}
            onClick={() => setActiveTab("inbox")}
          >
            Inbox
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
            active={activeTab === "settings"}
            onClick={() => setActiveTab("settings")}
          >
            Settings
          </TabButton>
        </nav>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === "map" ? (
          <div className="grid min-h-full gap-0 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="min-w-0 p-4 lg:p-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("factoryRoute.mapEyebrow")}
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
  return value === "inbox" ||
    value === "rules" ||
    value === "automations" ||
    value === "settings"
    ? value
    : "map";
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
      setDraft(null);
      return;
    }
    if (selected.id !== selectedId) {
      selectAutomation(selected.id);
      return;
    }
    setDraft(draftForAutomation(selected));
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
    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(220px,.35fr)_minmax(0,1fr)] lg:p-6">
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
                  <span className="mt-1 block text-xs text-muted-foreground">
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
                    {(draft.runs ?? draft.pastRuns ?? []).map((run, index) => (
                      <div
                        key={run.id ?? `${draft.id}-run-${index}`}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                      >
                        <span className="font-medium">{run.status ?? "-"}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatAutomationDate(run.startedAt)}
                        </span>
                        {run.error && (
                          <span className="basis-full text-xs text-destructive">
                            {run.error}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
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
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,.7fr)] lg:p-6">
      <Card>
        <CardHeader className="gap-3 border-b sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle className="text-base">
              {t("factoryRoute.inboxTitle")}
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("factoryRoute.inboxDescription")}
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
                    onClick={() => {
                      setSelectedId(id);
                      setVerdict(null);
                      setFeedbackNote("");
                    }}
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
  const query = useActionQuery("get-triage-config", {});
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
  }, [query.data]);
  return (
    <div className="max-w-4xl p-4 lg:p-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("triage.settingsTitle")}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("factoryRoute.settingsDescription")}
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="factory-slack-workspace">
              {t("triage.slackWorkspace")}
            </Label>
            <select
              id="factory-slack-workspace"
              value={workspace}
              onChange={(event) =>
                setWorkspace(event.target.value as "primary" | "secondary")
              }
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="primary">primary</option>
              <option value="secondary">secondary</option>
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="factory-slack-channel-id">
              {t("triage.slackChannelId")}
            </Label>
            <Input
              id="factory-slack-channel-id"
              value={channelId}
              onChange={(event) => setChannelId(event.target.value)}
              placeholder="C0123456789"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="factory-slack-channel-name">
              {t("triage.slackChannelName")}
            </Label>
            <Input
              id="factory-slack-channel-name"
              value={channelName}
              onChange={(event) => setChannelName(event.target.value)}
              placeholder="product-agent-native-feedback"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="factory-repository">{t("triage.repository")}</Label>
            <Input
              id="factory-repository"
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
              placeholder={t("triage.repositoryPlaceholder")}
            />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Checkbox
              checked={polling}
              onCheckedChange={(checked) => setPolling(checked === true)}
            />
            {t("triage.enablePolling")}
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Checkbox
              checked={githubPolling}
              onCheckedChange={(checked) => setGithubPolling(checked === true)}
            />
            {t("triage.enableGithubPolling")}
          </label>
          <div className="grid gap-1.5">
            <Label htmlFor="factory-sentry-org">
              {t("triage.sentryOrgSlug")}
            </Label>
            <Input
              id="factory-sentry-org"
              value={sentryOrgSlug}
              onChange={(event) => setSentryOrgSlug(event.target.value)}
              placeholder={t("triage.sentryOrgPlaceholder")}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="factory-sentry-project">
              {t("triage.sentryProjectSlug")}
            </Label>
            <Input
              id="factory-sentry-project"
              value={sentryProjectSlug}
              onChange={(event) => setSentryProjectSlug(event.target.value)}
              placeholder={t("triage.sentryProjectPlaceholder")}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="factory-sentry-environment">
              {t("triage.sentryEnvironment")}
            </Label>
            <Input
              id="factory-sentry-environment"
              value={sentryEnvironment}
              onChange={(event) => setSentryEnvironment(event.target.value)}
              placeholder={t("triage.sentryEnvironmentPlaceholder")}
            />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Checkbox
              checked={sentryPolling}
              onCheckedChange={(checked) => setSentryPolling(checked === true)}
            />
            {t("triage.enableSentryPolling")}
          </label>
          <div className="sm:col-span-2">
            <Button
              onClick={() =>
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
                })
              }
              disabled={mutation.isPending}
            >
              {mutation.isPending && <IconLoader2 className="animate-spin" />}
              {t("triage.saveSettings")}
            </Button>
          </div>
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
