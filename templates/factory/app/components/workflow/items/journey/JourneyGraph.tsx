import { useEffect, useMemo } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  WorkflowCanvas,
  useWorkflowEditor,
} from "@/components/workflow-canvas";
import type { WorkflowGraph } from "@/lib/workflow-editor";

import { useItemsStrings } from "../../items-strings";
import { WORKFLOW_CATALOG } from "../../workflow-catalog";
import { classifyReadError } from "../read-failure";
import { ReadErrorState } from "../read-support";
import type { ItemJourneyData } from "../read-types";
import { journeyOverlay } from "./journey-model";

const GRAPH_HEIGHT = "h-80";

export function JourneyGraphSkeleton() {
  const s = useItemsStrings();

  return (
    <Skeleton
      className={`${GRAPH_HEIGHT} w-full rounded-lg`}
      role="status"
      aria-label={s.journey.graphLoading}
    />
  );
}

function LitGraph({
  graph,
  journey,
  selectedNodeId,
  onSelectNode,
}: {
  graph: WorkflowGraph;
  journey: ItemJourneyData;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
}) {
  const s = useItemsStrings();

  const editor = useWorkflowEditor({
    graph,
    catalog: WORKFLOW_CATALOG,
    initialSelection: {
      nodeIds: selectedNodeId === null ? [] : [selectedNodeId],
      edgeIds: [],
    },
    onSelectionChange: (selection) =>
      onSelectNode(
        selection.nodeIds.length === 1 ? (selection.nodeIds[0] ?? null) : null,
      ),
  });
  const { overlay, missingNodeCount } = useMemo(
    () => journeyOverlay(graph, journey),
    [graph, journey],
  );

  // A step picked in the timeline is the step selected on the canvas.
  useEffect(() => {
    const current = editor.getSnapshot().selection.nodeIds;
    const same =
      selectedNodeId === null
        ? current.length === 0
        : current.length === 1 && current[0] === selectedNodeId;
    if (same) return;
    editor.select({
      nodeIds: selectedNodeId === null ? [] : [selectedNodeId],
      edgeIds: [],
    });
  }, [editor, selectedNodeId]);

  return (
    <div className="space-y-2">
      <div
        className={`${GRAPH_HEIGHT} overflow-hidden rounded-lg border border-border bg-card`}
      >
        <WorkflowCanvas editor={editor} readOnly overlay={overlay} />
      </div>
      {missingNodeCount > 0 ? (
        <p className="text-xs text-muted-foreground">
          {s.journey.pathRemoved(missingNodeCount)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The workflow drawn read-only with the item's path lit. The journey still
 * reads without it, so a graph that will not load is its own inline failure.
 */
export function JourneyGraph({
  graph,
  loadError,
  onRetry,
  journey,
  selectedNodeId,
  onSelectNode,
}: {
  /** Undefined while the workflow is loading or when it failed to load. */
  graph: WorkflowGraph | undefined;
  loadError: unknown;
  onRetry: () => void;
  journey: ItemJourneyData;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
}) {
  const s = useItemsStrings();

  return (
    <section aria-label={s.journey.graphLabel}>
      {graph ? (
        <LitGraph
          graph={graph}
          journey={journey}
          selectedNodeId={selectedNodeId}
          onSelectNode={onSelectNode}
        />
      ) : loadError ? (
        <ReadErrorState
          failure={classifyReadError(loadError)}
          action="get-factory-workflow"
          onRetry={onRetry}
        />
      ) : (
        <JourneyGraphSkeleton />
      )}
    </section>
  );
}
