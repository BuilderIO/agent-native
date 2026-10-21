import { IconRepeat } from "@tabler/icons-react";
import {
  EdgeLabelRenderer,
  Position,
  getBezierPath,
  useStore,
  type EdgeProps,
} from "@xyflow/react";
import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { backEdgeGeometry } from "@/lib/workflow-editor";

import { EdgeActionButtons, EdgeActionsContext } from "./EdgeToolbar";
import type {
  WorkflowEdgeData,
  WorkflowFlowEdge,
  WorkflowFlowNode,
} from "./flow-model";
import { IssueMark } from "./IssueMark";
import { useWorkflowCanvasStrings } from "./strings";

import "./workflow-edges.css";

/** Hover controls outlast the pointer by this much, so the pointer can cross the gap onto them. */
const HOVER_LINGER_MS = 150;

type Tone = "default" | "hover" | "flowed" | "selected" | "dimmed" | "issue";

const TONES: readonly Tone[] = [
  "default",
  "hover",
  "flowed",
  "selected",
  "dimmed",
  "issue",
];

function toneOf(
  data: WorkflowEdgeData | undefined,
  selected: boolean,
  hovered: boolean,
): Tone {
  if (selected) return "selected";
  if (data?.issues.length) return "issue";
  if (data?.flowed) return "flowed";
  if (hovered) return "hover";
  return data?.state === "dimmed" ? "dimmed" : "default";
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

/** The starter graph: one trigger wired straight to one end, and nothing else. */
function isStarter(
  nodes: readonly WorkflowFlowNode[],
  edges: readonly WorkflowFlowEdge[],
  edgeId: string,
): boolean {
  if (nodes.length !== 2 || edges.length !== 1 || edges[0].id !== edgeId) {
    return false;
  }
  const kinds = new Map(nodes.map((node) => [node.id, node.data.node.kind]));
  return (
    kinds.get(edges[0].source) === "trigger" &&
    kinds.get(edges[0].target) === "end"
  );
}

/** The count and problem pill. It is centred on the midpoint, or sits beside the starter's Add button. */
function EdgePill({
  beside,
  children,
}: {
  beside?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      data-beside={beside ? true : undefined}
      className="workflow-edge-pill flex items-center gap-1 whitespace-nowrap rounded-full border border-border bg-card px-1.5 py-0.5 text-xs leading-none text-muted-foreground"
    >
      {children}
    </div>
  );
}

/** "3 items", or "3 items total" when the source step ran more than once. */
function ItemCount({ count, repeated }: { count: number; repeated: boolean }) {
  const s = useWorkflowCanvasStrings();
  return (
    <span className="tabular-nums text-foreground">
      {repeated ? s.edge.itemsTotal(count) : s.edge.items(count)}
    </span>
  );
}

/** A zero-size point at a connection's midpoint, which its pill and controls hang from. */
function EdgeAnchor({
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
        style={{ transform: `translate(${x}px, ${y}px)` }}
        className="workflow-edge-anchor nodrag nopan"
      >
        {children}
      </div>
    </EdgeLabelRenderer>
  );
}

/** Hover that outlasts the pointer by `HOVER_LINGER_MS`, so it can move onto the controls. */
function useEdgeHover() {
  const [hovered, setHovered] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = useCallback(() => clearTimeout(timer.current), []);
  useEffect(() => cancel, [cancel]);
  return {
    hovered,
    enter: () => {
      cancel();
      setHovered(true);
    },
    leave: () => {
      cancel();
      timer.current = setTimeout(() => setHovered(false), HOVER_LINGER_MS);
    },
  };
}

/** The line, with a wider invisible band over it so a pointer can aim at it. */
function EdgeStroke({
  id,
  path,
  tone,
  back,
  onPointerEnter,
  onPointerLeave,
}: {
  id: string;
  path: string;
  tone: Tone;
  back?: boolean;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  return (
    <>
      <path
        id={id}
        d={path}
        className="react-flow__edge-path workflow-edge"
        markerEnd={`url(#workflow-arrow-${tone})`}
        data-tone={tone}
        data-back={back ? true : undefined}
      />
      <path
        d={path}
        className="workflow-edge-hit"
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      />
    </>
  );
}

function ForwardEdgeImpl(props: EdgeProps<WorkflowFlowEdge>) {
  const { id, data, selected } = props;
  const actions = useContext(EdgeActionsContext);
  const hover = useEdgeHover();
  const starter = useStore((state) =>
    isStarter(
      state.nodes as WorkflowFlowNode[],
      state.edges as WorkflowFlowEdge[],
      id,
    ),
  );
  const [path, labelX, labelY] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: Position.Right,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: Position.Left,
  });
  const hovered = actions !== null && hover.hovered;
  const count = data?.count ?? 0;
  const hasInfo = count > 0 || (data?.issues.length ?? 0) > 0;
  const showInfo = hasInfo && !hovered;
  // The starter's only connection keeps its Add step up at rest, so a first step is one click away.
  const showActions = actions !== null && (hovered || starter);
  // With Add up at rest, the pill moves to Add's left instead of covering it.
  const beside = showActions && !hovered;
  return (
    <>
      <EdgeStroke
        id={id}
        path={path}
        tone={toneOf(data, Boolean(selected), hovered)}
        onPointerEnter={hover.enter}
        onPointerLeave={hover.leave}
      />
      {(showInfo || showActions) && (
        <EdgeAnchor x={labelX} y={labelY}>
          {showInfo && (
            <EdgePill beside={beside}>
              {count > 0 && (
                <ItemCount count={count} repeated={data?.repeated === true} />
              )}
              <IssueMark issues={data?.issues ?? []} className="size-4" />
            </EdgePill>
          )}
          {showActions && (
            <EdgeActionButtons
              edgeId={id}
              insert
              remove={hovered}
              onPointerEnter={hover.enter}
              onPointerLeave={hover.leave}
            />
          )}
        </EdgeAnchor>
      )}
    </>
  );
}

function BackEdgeImpl(props: EdgeProps<WorkflowFlowEdge>) {
  const s = useWorkflowCanvasStrings();
  const actions = useContext(EdgeActionsContext);
  const hover = useEdgeHover();

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
  const hovered = actions !== null && hover.hovered;
  return (
    <>
      <EdgeStroke
        id={id}
        path={path}
        tone={toneOf(data, Boolean(selected), hovered)}
        back
        onPointerEnter={hover.enter}
        onPointerLeave={hover.leave}
      />
      <EdgeAnchor x={labelX} y={labelY}>
        {hovered ? (
          <EdgeActionButtons
            edgeId={id}
            insert={false}
            remove
            onPointerEnter={hover.enter}
            onPointerLeave={hover.leave}
          />
        ) : (
          <EdgePill>
            <IconRepeat className="size-3" aria-hidden />
            <span>{s.loopCap(data?.edge.back?.maxIterations ?? 0)}</span>
            {(data?.count ?? 0) > 0 && (
              <ItemCount
                count={data?.count ?? 0}
                repeated={data?.repeated === true}
              />
            )}
            <IssueMark issues={data?.issues ?? []} className="size-4" />
          </EdgePill>
        )}
      </EdgeAnchor>
    </>
  );
}

export const ForwardEdge = memo(ForwardEdgeImpl);
export const BackEdge = memo(BackEdgeImpl);
