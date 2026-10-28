import { useLocale } from "@agent-native/core/client/i18n";
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconArrowRight,
  IconCheck,
  IconFlask,
  IconLoader2,
  type Icon,
} from "@tabler/icons-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { portLabel } from "@/components/workflow-canvas/flow-model";
import { NODE_KIND_ICONS } from "@/components/workflow-canvas/node-kinds";
import { nodeTitle } from "@/components/workflow-canvas/node-summary";
import { useWorkflowCanvasStrings } from "@/components/workflow-canvas/strings";
import { cn } from "@/lib/utils";
import {
  portsWithLimit,
  type WorkflowCatalog,
  type WorkflowGraph,
  type WorkflowNode,
} from "@/lib/workflow-editor";

import type {
  NodeData,
  NodeDataInPort,
} from "../../../../server/workflow-host/read-models.js";
import { useItemsStrings } from "../items-strings";
import { formatDateTime, formatDuration } from "../items/format";
import { PARKED_PORT } from "../items/port-label";
import type { ReadFailure } from "../items/read-failure";
import { ReadErrorState } from "../items/read-support";
import { TestStepButton } from "../TestStepButton";
import { useWorkflowStrings } from "../workflow-strings";
import {
  declaredFieldsOf,
  previewSchemaOf,
  storedItemsOf,
} from "./node-data-model";
import {
  CountAndSearch,
  DataItems,
  DataPane,
  rowsFor,
  useCountText,
} from "./NodeDataPane";
import { SchemaView } from "./NodeDataSchema";
import { DataSkeleton, EmptyData } from "./NodeDataStates";
import { useDataView, useDebouncedSearch } from "./use-node-data-view";

type StepOf = NonNullable<NodeData["step"]>;

const STEP_MARKS: Partial<
  Record<StepOf["status"], { icon: Icon; tone: string }>
> = {
  succeeded: { icon: IconCheck, tone: "text-success" },
  failed: { icon: IconAlertCircle, tone: "text-destructive" },
  needs_check: { icon: IconAlertTriangle, tone: "text-destructive" },
  running: {
    icon: IconLoader2,
    tone: "text-muted-foreground motion-safe:animate-spin",
  },
};

/** The Items tab, filtered to the items this workflow has parked. */
function parkedItemsHref(factoryId: string, workflowId: string): string {
  const params = new URLSearchParams({
    factoryId,
    tab: "items",
    parked: "true",
    workflow: workflowId,
  });
  return `/factory?${params.toString()}`;
}

/** What both panes read: the step, the node data read for it, and how that read stands. */
interface PaneBase {
  node: WorkflowNode;
  catalog: WorkflowCatalog;
  /** Null until a read succeeds, and for a step not saved yet, which has never run. */
  data: NodeData | null;
  loading: boolean;
  failure: ReadFailure | null;
  onRetry: () => void;
}

export function NodeDetailsInputPane({
  graph,
  starting,
  onTestWorkflow,
  ...base
}: PaneBase & {
  graph: WorkflowGraph;
  /** A save or a run is starting. */
  starting: boolean;
  onTestWorkflow: () => void;
}) {
  const { node, catalog, data, loading, failure, onRetry } = base;
  const ws = useWorkflowStrings();
  const canvas = useWorkflowCanvasStrings();
  const countText = useCountText();
  const [view, setView] = useDataView("input");
  const { draft, setDraft, query } = useDebouncedSearch();
  const [picked, setPicked] = useState<string | null>(null);

  const incoming = graph.edges.filter((edge) => edge.to.node === node.id);
  const sources = data?.in ?? [];
  const source =
    sources.find((entry) => entry.edgeId === picked) ??
    sources.find((entry) => entry.count > 0) ??
    sources[0];
  const hasItems = source !== undefined && source.count > 0;
  const searching = view !== "schema" && query !== "";
  const rows = source ? rowsFor(source.items, view, query) : [];
  const upstreamId = source?.fromNodeId ?? incoming[0]?.from.node;
  const upstream = graph.nodes.find((candidate) => candidate.id === upstreamId);
  // A trigger makes no items, so there is nothing to preview from one.
  const preview =
    upstream && upstream.kind !== "trigger"
      ? previewSchemaOf(declaredFieldsOf(upstream, catalog))
      : [];

  const stepLabel = (entry: NodeDataInPort) => {
    const step = graph.nodes.find(
      (candidate) => candidate.id === entry.fromNodeId,
    );
    if (!step) return { step: undefined, label: ws.nodeData.removedStep };
    const title = nodeTitle(step, catalog, canvas);
    const several = portsWithLimit(graph, step).length > 1;
    return {
      step,
      label: several
        ? `${title} · ${portLabel(step, entry.fromPort, canvas)}`
        : title,
    };
  };

  const picker =
    incoming.length > 0 && sources.length > 0 && source ? (
      <Select value={source.edgeId} onValueChange={setPicked}>
        <SelectTrigger
          size="sm"
          aria-label={ws.nodeData.sourceLabel}
          className="w-full min-w-0"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sources.map((entry) => {
            const { step, label } = stepLabel(entry);
            return (
              <SelectItem key={entry.edgeId} value={entry.edgeId}>
                <StepName step={step} label={label} />
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    ) : null;

  const toolbar =
    hasItems && source ? (
      <CountAndSearch
        count={countText(source, searching ? rows.length : null)}
        truncated={
          view === "schema" &&
          storedItemsOf(source.items).some((item) => item.truncated)
        }
        draft={draft}
        onDraft={setDraft}
      />
    ) : null;

  let body: ReactNode;
  if (incoming.length === 0) {
    body = <EmptyData title={ws.nodeData.noInputConnected} />;
  } else if (loading) {
    body = <DataSkeleton />;
  } else if (failure) {
    body = (
      <ReadErrorState
        failure={failure}
        action="get-workflow-node-data"
        onRetry={onRetry}
      />
    );
  } else if (!source || !hasItems) {
    body = (
      <>
        <EmptyData
          title={ws.nodeData.noInputData}
          hint={ws.nodeData.testWorkflowHint}
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={starting}
              onClick={onTestWorkflow}
            >
              <IconFlask />
              {ws.nodeData.testWorkflow}
            </Button>
          }
        />
        {view === "schema" && preview.length > 0 ? (
          <SchemaView
            fields={preview}
            query=""
            notice={<PreviewHint />}
            dragSource
          />
        ) : null}
      </>
    );
  } else {
    body = (
      <DataItems
        view={view}
        items={source.items}
        rows={rows}
        query={query}
        onClear={() => setDraft("")}
        dragSource
      />
    );
  }

  return (
    <DataPane
      title={ws.nodeDetails.inputTitle}
      className="border-e border-border"
      view={view}
      onView={setView}
      picker={picker}
      toolbar={toolbar}
    >
      {body}
    </DataPane>
  );
}

export function NodeDetailsOutputPane({
  factoryId,
  workflowId,
  onServer,
  dirty,
  starting,
  parkedCount,
  onTest,
  ...base
}: PaneBase & {
  factoryId: string;
  workflowId: string;
  /** The step is in the workflow the server has, so it can be tested. */
  onServer: boolean;
  dirty: boolean;
  /** A save or a run is starting. */
  starting: boolean;
  /** Items waiting at this step, when it is a Wait. */
  parkedCount: number;
  onTest: (nodeId: string, sampleItemIds: string[]) => void;
}) {
  const { node, catalog, data, loading, failure, onRetry } = base;
  const ws = useWorkflowStrings();
  const canvas = useWorkflowCanvasStrings();
  const countText = useCountText();
  const [view, setView] = useDataView("output");
  const { draft, setDraft, query } = useDebouncedSearch();
  const [picked, setPicked] = useState<string | null>(null);

  // A Wait's parked count is a count of items it holds, not an output that leaves it.
  const ports = (data?.out ?? []).filter((entry) => entry.port !== PARKED_PORT);
  const port =
    ports.find((entry) => entry.port === picked) ??
    ports.find((entry) => entry.count > 0) ??
    ports[0];
  const hasItems = port !== undefined && port.count > 0;
  const searching = view !== "schema" && query !== "";
  const rows = port ? rowsFor(port.items, view, query) : [];
  const preview = previewSchemaOf(declaredFieldsOf(node, catalog));

  const mark = data?.step ? <RunMark step={data.step} run={data.run} /> : null;

  const tabs =
    ports.length > 1 && port ? (
      <Tabs value={port.port} onValueChange={setPicked}>
        <TabsList
          aria-label={ws.nodeData.portsLabel}
          className="max-w-full overflow-x-auto"
        >
          {ports.map((entry) => (
            <TabsTrigger key={entry.port} value={entry.port}>
              {portLabel(node, entry.port, canvas)}
              <span className="ms-1.5 tabular-nums text-muted-foreground">
                {entry.count}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    ) : null;

  const waiting =
    node.kind === "wait" && parkedCount > 0 ? (
      <Link
        to={parkedItemsHref(factoryId, workflowId)}
        className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
      >
        {canvas.waiting(parkedCount)}
        <IconArrowRight className="size-3" aria-hidden />
      </Link>
    ) : null;

  const picker =
    tabs !== null || waiting !== null ? (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {tabs}
        {waiting}
      </div>
    ) : null;

  const toolbar =
    hasItems && port ? (
      <CountAndSearch
        count={countText(port, searching ? rows.length : null)}
        truncated={
          view === "schema" &&
          storedItemsOf(port.items).some((item) => item.truncated)
        }
        draft={draft}
        onDraft={setDraft}
      />
    ) : null;

  let body: ReactNode;
  if (loading) {
    body = <DataSkeleton />;
  } else if (failure) {
    body = (
      <ReadErrorState
        failure={failure}
        action="get-workflow-node-data"
        onRetry={onRetry}
      />
    );
  } else if (!port || !hasItems) {
    body = (
      <>
        <EmptyData
          title={ws.nodeData.noOutputData}
          action={
            <div className="w-48">
              <TestStepButton
                factoryId={factoryId}
                workflowId={workflowId}
                node={node}
                onServer={onServer}
                dirty={dirty}
                busy={starting}
                onTest={onTest}
              />
            </div>
          }
        />
        {view === "schema" ? (
          <SchemaView fields={preview} query="" notice={<PreviewHint />} />
        ) : null}
      </>
    );
  } else {
    body = (
      <DataItems
        view={view}
        items={port.items}
        rows={rows}
        query={query}
        onClear={() => setDraft("")}
      />
    );
  }

  return (
    <DataPane
      title={ws.nodeDetails.outputTitle}
      mark={mark}
      view={view}
      onView={setView}
      picker={picker}
      toolbar={toolbar}
    >
      {body}
    </DataPane>
  );
}

function PreviewHint() {
  const ws = useWorkflowStrings();
  return (
    <p className="pb-2 text-sm text-muted-foreground">
      {ws.nodeData.previewHint}
    </p>
  );
}

/** The step a source row names: its kind's icon, then its title (and port, when it has several). */
function StepName({
  step,
  label,
}: {
  step: WorkflowNode | undefined;
  label: string;
}) {
  const KindIcon = step ? NODE_KIND_ICONS[step.kind] : null;
  return (
    <span className="flex min-w-0 items-center gap-2">
      {KindIcon ? <KindIcon className="size-3.5 shrink-0" aria-hidden /> : null}
      <span className="truncate">{label}</span>
    </span>
  );
}

/** How the output's step ended, as an icon with the run's mode, start and duration on hover. A skipped step shows nothing. */
function RunMark({ step, run }: { step: StepOf; run: NodeData["run"] }) {
  const ws = useWorkflowStrings();
  const s = useItemsStrings();
  const { locale } = useLocale();
  const mark = STEP_MARKS[step.status];
  if (!mark) return null;
  const MarkIcon = mark.icon;
  const label = s.audit.stepStatus[step.status];
  const took =
    step.finishedAt === null
      ? null
      : Date.parse(step.finishedAt) - Date.parse(step.startedAt);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          tabIndex={0}
          aria-label={label}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-md"
        >
          <MarkIcon className={cn("size-4", mark.tone)} aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="flex flex-col items-start gap-0.5">
          <span>{label}</span>
          {run ? <span>{s.mode[run.mode]}</span> : null}
          <span>
            {ws.nodeData.runStarted(formatDateTime(step.startedAt, locale))}
          </span>
          {took !== null && Number.isFinite(took) ? (
            <span>{ws.nodeData.runTook(formatDuration(took, s))}</span>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
