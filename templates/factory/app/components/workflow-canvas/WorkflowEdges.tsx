import { IconRepeat } from "@tabler/icons-react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useStore,
  type EdgeProps,
} from "@xyflow/react";
import { memo } from "react";

import { backEdgeGeometry } from "@/lib/workflow-editor";

import type { WorkflowEdgeData, WorkflowFlowEdge } from "./flow-model";
import { IssueMark } from "./IssueMark";
import { useWorkflowCanvasStrings } from "./strings";

type Tone = "default" | "selected" | "lit" | "dimmed" | "issue";

const TONES: readonly Tone[] = [
  "default",
  "selected",
  "lit",
  "dimmed",
  "issue",
];

function toneOf(data: WorkflowEdgeData | undefined, selected: boolean): Tone {
  if (selected) return "selected";
  if (data?.issues.length) return "issue";
  return data?.state === "lit" || data?.state === "dimmed"
    ? data.state
    : "default";
}

/** Arrowheads are drawn from tokens here because React Flow's own markers take a fixed color. */
export function WorkflowMarkerDefs() {
  return (
    <svg aria-hidden className="pointer-events-none absolute size-0">
      <defs>
        {TONES.map((tone) => (
          <marker
            key={tone}
            id={`workflow-arrow-${tone}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="9"
            markerHeight="9"
            markerUnits="userSpaceOnUse"
            orient="auto-start-reverse"
          >
            <path
              d="M 0 1 L 9 5 L 0 9 z"
              className="workflow-arrow"
              data-state={tone}
            />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

function EdgeBadge({
  x,
  y,
  children,
}: {
  x: number;
  y: number;
  children: React.ReactNode;
}) {
  return (
    <EdgeLabelRenderer>
      <div
        style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
        className="nodrag nopan pointer-events-auto absolute flex items-center gap-1 rounded-full border border-border bg-card px-1.5 py-0.5 text-xs leading-none text-muted-foreground"
      >
        {children}
      </div>
    </EdgeLabelRenderer>
  );
}

function ForwardEdgeImpl(props: EdgeProps<WorkflowFlowEdge>) {
  const { id, data, selected } = props;
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    borderRadius: 14,
    offset: 24,
  });
  const tone = toneOf(data, Boolean(selected));
  const showBadge = data?.count !== undefined || (data?.issues.length ?? 0) > 0;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={`url(#workflow-arrow-${tone})`}
        className="workflow-edge"
        data-tone={tone}
        interactionWidth={18}
      />
      {showBadge && (
        <EdgeBadge x={labelX} y={labelY}>
          {data?.count !== undefined && (
            <span className="tabular-nums text-foreground">{data.count}</span>
          )}
          <IssueMark issues={data?.issues ?? []} className="size-4" />
        </EdgeBadge>
      )}
    </>
  );
}

function BackEdgeImpl(props: EdgeProps<WorkflowFlowEdge>) {
  const s = useWorkflowCanvasStrings();

  const { id, data, selected, sourceX, sourceY, targetX, targetY } = props;
  // The detour clears every node under the loop, so it needs their bottoms.
  const bottom = useStore((state) => {
    let lowest = Number.NEGATIVE_INFINITY;
    for (const node of state.nodeLookup.values()) {
      const left = node.internals.positionAbsolute.x;
      const width = node.measured.width ?? 0;
      if (left + width >= targetX - 32 && left <= sourceX + 32) {
        lowest = Math.max(
          lowest,
          node.internals.positionAbsolute.y + (node.measured.height ?? 0),
        );
      }
    }
    return lowest;
  });
  const { path, labelX, labelY } = backEdgeGeometry({
    source: { x: sourceX, y: sourceY },
    target: { x: targetX, y: targetY },
    bottom,
    lane: data?.lane,
  });
  const tone = toneOf(data, Boolean(selected));
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={`url(#workflow-arrow-${tone})`}
        className="workflow-edge"
        data-tone={tone}
        data-back
        interactionWidth={18}
      />
      <EdgeBadge x={labelX} y={labelY}>
        <IconRepeat className="size-3" aria-hidden />
        <span>{s.loopCap(data?.edge.back?.maxIterations ?? 0)}</span>
        {data?.count !== undefined && (
          <span className="tabular-nums text-foreground">{data.count}</span>
        )}
        <IssueMark issues={data?.issues ?? []} className="size-4" />
      </EdgeBadge>
    </>
  );
}

export const ForwardEdge = memo(ForwardEdgeImpl);
export const BackEdge = memo(BackEdgeImpl);
