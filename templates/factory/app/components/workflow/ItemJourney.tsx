import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useLocale } from "@agent-native/core/client/i18n";
import {
  IconExternalLink,
  IconMessage,
  IconRoute,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkflowCanvasStrings } from "@/components/workflow-canvas/strings";
import { safeHttpUrl } from "@/lib/safe-http-url";
import type { WorkflowGraph } from "@/lib/workflow-editor";

import { useItemsStrings } from "./items-strings";
import { formatRelative } from "./items/format";
import { itemPhase, needsYouText, sourceLabel } from "./items/item-status";
import { ItemTitle } from "./items/ItemListRow";
import { ItemStatusChip } from "./items/ItemStatusChip";
import {
  currentNodeId,
  journeyAgentContext,
} from "./items/journey/journey-model";
import {
  JourneyGraph,
  JourneyGraphSkeleton,
} from "./items/journey/JourneyGraph";
import { JourneyReceipts } from "./items/journey/JourneyReceipts";
import {
  JourneyRecoveryActions,
  canRecover,
  useJourneyRecovery,
} from "./items/journey/JourneyRecovery";
import { JourneyState } from "./items/journey/JourneyState";
import {
  JourneyTimeline,
  TimelineSkeleton,
} from "./items/journey/JourneyTimeline";
import { portLabeler } from "./items/port-label";
import { classifyReadError } from "./items/read-failure";
import { ReadErrorState, useNow } from "./items/read-support";
import type { ItemJourneyData, OpenWorkflow } from "./items/read-types";

interface ItemJourneyProps {
  factoryId: string;
  workflowId: string;
  itemId: string;
  /** `target` is optional: a page that only handles `(workflowId, nodeId?)` still fits. */
  onOpenWorkflow?: OpenWorkflow;
  onClose?: () => void;
}

const JOURNEY_PAGE = 100;

function CloseButton({ onClose }: { onClose: () => void }) {
  const s = useItemsStrings();

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={s.journey.close}
      onClick={onClose}
    >
      <IconX />
    </Button>
  );
}

function JourneySkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy>
      <div className="space-y-3 border-b border-border px-5 py-4">
        <Skeleton className="h-6 w-3/5" />
        <Skeleton className="h-4 w-2/5" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-52" />
        </div>
      </div>
      <div className="space-y-6 px-5 py-4">
        <JourneyGraphSkeleton />
        <TimelineSkeleton />
      </div>
    </div>
  );
}

export function ItemJourney({
  factoryId,
  workflowId,
  itemId,
  onOpenWorkflow,
  onClose,
}: ItemJourneyProps) {
  const s = useItemsStrings();
  const canvasStrings = useWorkflowCanvasStrings();
  const { locale } = useLocale();

  const nowMs = useNow();
  // `undefined` until the viewer picks: then the journey points at where the item is now.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const body = useRef<HTMLDivElement>(null);
  const query = useActionQuery<ItemJourneyData>("get-item-journey", {
    factoryId,
    workflowId,
    itemId,
    limit: JOURNEY_PAGE,
  });
  const workflow = useActionQuery<{ graph: WorkflowGraph; enabled: boolean }>(
    "get-factory-workflow",
    { factoryId, workflowId },
  );
  const graph = workflow.data?.graph;
  const recovery = useJourneyRecovery({
    factoryId,
    itemId,
    workflowOn: workflow.data?.enabled,
    refetch: query.refetch,
  });
  const labelPort = useMemo(
    () => portLabeler(graph, s, canvasStrings),
    [graph, s, canvasStrings],
  );
  const journeyNow = query.data;
  const selectedNodeId =
    picked !== undefined
      ? picked
      : journeyNow && graph
        ? currentNodeId(journeyNow, graph)
        : null;

  // Picking a step on the graph brings that step's events into view. The step
  // the journey opens on is not a pick, so opening never scrolls the page.
  useEffect(() => {
    if (!picked) return;
    const root = body.current;
    const first = root?.querySelector<HTMLElement>(
      `[data-node-id="${CSS.escape(picked)}"]`,
    );
    if (!first) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    first.scrollIntoView({
      block: "nearest",
      behavior: reduced ? "auto" : "smooth",
    });
  }, [picked]);

  const journey = query.data;
  if (!journey) {
    if (!query.isError) return <JourneySkeleton />;
    return (
      <div className="space-y-3 p-5">
        {onClose ? (
          <div className="flex justify-end">
            <CloseButton onClose={onClose} />
          </div>
        ) : null}
        <ReadErrorState
          failure={classifyReadError(query.error)}
          action="get-item-journey"
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  // A move on its way to the server reads as done: the item is no longer waiting on a person.
  const moving = recovery.pending !== null;
  const state =
    moving && journey.state
      ? { ...journey.state, needsYouReasons: [] }
      : journey.state;
  const phase = itemPhase(
    {
      status: moving
        ? recovery.pending === "dismissed"
          ? "dismissed"
          : null
        : journey.item.status,
      parked: moving ? null : (state?.parked ?? null),
      needsYouReasons: state?.needsYouReasons ?? [],
    },
    s,
  );
  const reasons = needsYouText(state?.needsYouReasons ?? [], s);
  const sourceUrl = safeHttpUrl(journey.item.sourceUrl);
  const source = sourceLabel(journey.item.source, s);
  const lastActivity = formatRelative(state?.lastActivityAt, nowMs, locale);

  const askAgent = () => {
    sendToAgentChat({
      message: s.journey.askMessage,
      context: journeyAgentContext(factoryId, journey),
      submit: true,
      openSidebar: true,
    });
    // The agent panel sits behind a sheet; close it so the answer is in view.
    onClose?.();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 space-y-3 border-b border-border px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 break-words text-base font-semibold leading-6">
            <ItemTitle
              title={journey.item.title}
              source={journey.item.source}
              wrap
            />
          </h2>
          {onClose ? <CloseButton onClose={onClose} /> : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
          <ItemStatusChip phase={phase} />
          {reasons ? (
            <span className="font-medium text-destructive">{reasons}</span>
          ) : null}
          <span>{s.journey.inWorkflow(journey.workflow.name)}</span>
          {lastActivity ? <span>{lastActivity}</span> : null}
          {sourceUrl ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-2 hover:text-muted-foreground"
            >
              {source ? s.journey.openInSource(source) : s.journey.sourceLink}
              <IconExternalLink className="size-3.5" aria-hidden />
            </a>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {journey.item.inbox && canRecover(journey.item.status) && !moving ? (
            <JourneyRecoveryActions recovery={recovery} />
          ) : null}
          {onOpenWorkflow ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                onOpenWorkflow(journey.workflow.id, selectedNodeId ?? undefined)
              }
            >
              <IconRoute />
              {s.journey.openOnCanvas}
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={askAgent}>
            <IconMessage />
            {s.journey.askAgent}
          </Button>
        </div>
      </header>
      <div
        ref={body}
        className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4"
      >
        {query.isError ? (
          <ReadErrorState
            failure={classifyReadError(query.error)}
            action="get-item-journey"
            onRetry={() => void query.refetch()}
          />
        ) : null}
        <JourneyState state={state} inbox={journey.item.inbox} nowMs={nowMs} />
        <JourneyGraph
          graph={graph}
          loadError={workflow.isError ? workflow.error : null}
          onRetry={() => void workflow.refetch()}
          journey={journey}
          selectedNodeId={selectedNodeId}
          onSelectNode={setPicked}
        />
        <JourneyTimeline
          factoryId={factoryId}
          journey={journey}
          portLabel={labelPort}
          selectedNodeId={selectedNodeId}
          onSelectNode={setPicked}
          onOpenRun={
            onOpenWorkflow
              ? (runId) =>
                  onOpenWorkflow(journey.workflow.id, undefined, { runId })
              : undefined
          }
        />
        <JourneyReceipts
          receipts={journey.receipts}
          truncated={journey.receiptsTruncated}
          path={journey.path}
        />
      </div>
    </div>
  );
}
