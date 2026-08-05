import { useT } from "@agent-native/core/client/i18n";
import {
  IconAdjustmentsHorizontal,
  IconArrowsMaximize,
  IconBrandGithub,
  IconBrandSlack,
  IconChevronDown,
  IconGitPullRequest,
  IconMessageCircle,
  IconMinus,
  IconPlus,
  IconRobot,
  IconShieldCheck,
  IconTransform,
  IconUserCheck,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type FactoryCanvasNode = {
  id: string;
  label: string;
  description: string;
  kind:
    | "source"
    | "transform"
    | "decision"
    | "gate"
    | "agent"
    | "system"
    | "terminal";
  provider?:
    | "slack"
    | "github"
    | "builder"
    | "claude"
    | "codex"
    | "human"
    | "factory";
  agent?: string;
  metricsKey?: string;
  position: { x: number; y: number };
};

export type FactoryCanvasEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  condition: string;
};

export type FactoryCanvasGraph = {
  version: number;
  name: string;
  description: string;
  executionMode?: "blueprint";
  nodes: FactoryCanvasNode[];
  edges: FactoryCanvasEdge[];
};

const NODE_WIDTH = 210;
const NODE_HEIGHT = 122;
const CANVAS_WIDTH = 1320;
const CANVAS_HEIGHT = 660;

interface FactoryCanvasProps {
  graph: FactoryCanvasGraph;
  nodeMetrics?: Record<string, number>;
  commentCounts?: Record<string, number>;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
  onMoveNode?: (nodeId: string, position: { x: number; y: number }) => void;
  onComment: (
    targetType: "canvas" | "node" | "edge",
    targetId?: string,
  ) => void;
}

type DragState = {
  nodeId: string;
  offsetX: number;
  offsetY: number;
  startPosition: { x: number; y: number };
};

const DRAG_THRESHOLD = 3;

export function FactoryCanvas({
  graph,
  nodeMetrics = {},
  commentCounts = {},
  selectedNodeId,
  selectedEdgeId,
  onSelectNode,
  onSelectEdge,
  onMoveNode,
  onComment,
}: FactoryCanvasProps) {
  const t = useT();
  const [zoom, setZoom] = useState(0.72);
  const [fitZoom, setFitZoom] = useState(0.72);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragMoved = useRef(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const zoomWasAdjusted = useRef(false);
  const nodesById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateFitZoom = () => {
      const next = Math.min(
        0.9,
        Math.max(0.55, (viewport.clientWidth - 32) / CANVAS_WIDTH),
      );
      setFitZoom(next);
      if (!zoomWasAdjusted.current) setZoom(next);
    };

    updateFitZoom();
    const observer = new ResizeObserver(updateFitZoom);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  function nodeIcon(node: FactoryCanvasNode) {
    if (node.provider === "slack") return <IconBrandSlack className="size-4" />;
    if (node.provider === "github") {
      return node.kind === "terminal" ? (
        <IconGitPullRequest className="size-4" />
      ) : (
        <IconBrandGithub className="size-4" />
      );
    }
    if (node.provider === "human") return <IconUserCheck className="size-4" />;
    if (node.kind === "agent") return <IconRobot className="size-4" />;
    if (node.kind === "gate") return <IconShieldCheck className="size-4" />;
    if (node.kind === "decision")
      return <IconAdjustmentsHorizontal className="size-4" />;
    if (node.kind === "transform") return <IconTransform className="size-4" />;
    return <IconMessageCircle className="size-4" />;
  }

  function clampPosition(x: number, y: number) {
    return {
      x: Math.max(12, Math.min(CANVAS_WIDTH - NODE_WIDTH - 12, x)),
      y: Math.max(12, Math.min(CANVAS_HEIGHT - NODE_HEIGHT - 12, y)),
    };
  }

  function beginDrag(
    event: React.PointerEvent<HTMLButtonElement>,
    node: FactoryCanvasNode,
  ) {
    if (!onMoveNode) return;
    const target = event.currentTarget.closest("[data-factory-canvas]");
    if (!(target instanceof HTMLElement)) return;
    const rect = target.getBoundingClientRect();
    const scale = rect.width / CANVAS_WIDTH;
    setDragState({
      nodeId: node.id,
      offsetX: (event.clientX - rect.left) / scale - node.position.x,
      offsetY: (event.clientY - rect.top) / scale - node.position.y,
      startPosition: node.position,
    });
    dragMoved.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveNode(event: React.PointerEvent<HTMLButtonElement>) {
    if (!dragState || !onMoveNode) return;
    const target = event.currentTarget.closest("[data-factory-canvas]");
    if (!(target instanceof HTMLElement)) return;
    const rect = target.getBoundingClientRect();
    const scale = rect.width / CANVAS_WIDTH;
    const position = clampPosition(
      (event.clientX - rect.left) / scale - dragState.offsetX,
      (event.clientY - rect.top) / scale - dragState.offsetY,
    );
    const movedX = Math.abs(position.x - dragState.startPosition.x);
    const movedY = Math.abs(position.y - dragState.startPosition.y);
    if (
      !dragMoved.current &&
      movedX <= DRAG_THRESHOLD &&
      movedY <= DRAG_THRESHOLD
    ) {
      return;
    }
    dragMoved.current = true;
    onMoveNode(dragState.nodeId, position);
  }

  function endDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (dragState) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
        // coercion-ok: pointer capture is optional and drag state is cleared below.
      } catch {
        // Pointer capture may already have ended on touch browsers.
      }
    }
    setDragState(null);
  }

  return (
    <div className="relative min-h-[560px] overflow-hidden rounded-xl border bg-muted/20">
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between border-b bg-background/90 px-3 py-2 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">{t("factoryCanvas.dragHint")}</span>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={t("factoryCanvas.zoomOut")}
                onClick={() => {
                  zoomWasAdjusted.current = true;
                  setZoom((value) => Math.max(0.55, value - 0.1));
                }}
              >
                <IconMinus className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("factoryCanvas.zoomOut")}</TooltipContent>
          </Tooltip>
          <span className="w-10 text-center text-xs tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={t("factoryCanvas.zoomIn")}
                onClick={() => {
                  zoomWasAdjusted.current = true;
                  setZoom((value) => Math.min(1.15, value + 0.1));
                }}
              >
                <IconPlus className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("factoryCanvas.zoomIn")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={t("factoryCanvas.fitFactoryToView")}
                onClick={() => {
                  zoomWasAdjusted.current = false;
                  setZoom(fitZoom);
                }}
              >
                <IconArrowsMaximize className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("factoryCanvas.fitToView")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div ref={viewportRef} className="h-[560px] overflow-auto pt-12">
        <div
          data-factory-canvas
          className="relative origin-top-left"
          style={{
            width: `${CANVAS_WIDTH * zoom}px`,
            height: `${CANVAS_HEIGHT * zoom}px`,
          }}
        >
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{
              width: `${CANVAS_WIDTH}px`,
              height: `${CANVAS_HEIGHT}px`,
              transform: `scale(${zoom})`,
            }}
          >
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 size-full overflow-visible"
              viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
            >
              <defs>
                <marker
                  id="factory-arrow"
                  markerWidth="8"
                  markerHeight="8"
                  refX="7"
                  refY="4"
                  orient="auto"
                >
                  <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
                </marker>
              </defs>
              {graph.edges.map((edge) => {
                const source = nodesById.get(edge.source);
                const target = nodesById.get(edge.target);
                if (!source || !target) return null;
                const x1 = source.position.x + NODE_WIDTH;
                const y1 = source.position.y + NODE_HEIGHT / 2;
                const x2 = target.position.x;
                const y2 = target.position.y + NODE_HEIGHT / 2;
                const middle = x1 + (x2 - x1) / 2;
                const path = `M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}`;
                const selected = selectedEdgeId === edge.id;
                return (
                  <g
                    key={edge.id}
                    className={selected ? "text-primary" : "text-border"}
                  >
                    <path
                      d={path}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={selected ? 3 : 2}
                      strokeDasharray={selected ? undefined : "5 5"}
                      markerEnd="url(#factory-arrow)"
                    />
                  </g>
                );
              })}
            </svg>

            {graph.edges.map((edge) => {
              const source = nodesById.get(edge.source);
              const target = nodesById.get(edge.target);
              if (!source || !target) return null;
              const x1 = source.position.x + NODE_WIDTH;
              const y1 = source.position.y + NODE_HEIGHT / 2;
              const x2 = target.position.x;
              const y2 = target.position.y + NODE_HEIGHT / 2;
              const middle = x1 + (x2 - x1) / 2;
              const path = `M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}`;
              return (
                <button
                  key={`${edge.id}-hitbox`}
                  type="button"
                  aria-label={t("factoryCanvas.selectRoute", {
                    route: edge.label || edge.id,
                  })}
                  className="absolute inset-0 z-[1] block cursor-pointer bg-transparent text-left"
                  style={{
                    clipPath: "none",
                    pointerEvents: "none",
                  }}
                  onClick={() => onSelectEdge(edge.id)}
                >
                  <span
                    className="pointer-events-auto absolute h-4 w-full -translate-y-1/2 bg-transparent"
                    style={{
                      left: `${Math.min(x1, x2)}px`,
                      top: `${Math.min(y1, y2)}px`,
                      width: `${Math.abs(x2 - x1)}px`,
                      transform: `rotate(${Math.atan2(y2 - y1, x2 - x1)}rad)`,
                      transformOrigin: "left center",
                    }}
                  />
                  <span className="sr-only">{path}</span>
                </button>
              );
            })}

            {graph.nodes.map((node) => {
              const selected = selectedNodeId === node.id;
              const comments = commentCounts[node.id] ?? 0;
              const metric = nodeMetrics[node.id] ?? 0;
              return (
                <button
                  key={node.id}
                  type="button"
                  className={`absolute z-[2] flex h-[122px] w-[210px] flex-col rounded-xl border bg-card p-3 text-left shadow-sm transition-[border-color,box-shadow,transform] duration-150 ease-out hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-primary shadow-md ring-2 ring-primary/15" : "border-border"}`}
                  style={{ left: node.position.x, top: node.position.y }}
                  onClick={() => {
                    if (!dragMoved.current) onSelectNode(node.id);
                  }}
                  onPointerDown={(event) => beginDrag(event, node)}
                  onPointerMove={moveNode}
                  onPointerUp={endDrag}
                  onDoubleClick={() => onComment("node", node.id)}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        {nodeIcon(node)}
                      </span>
                      <span className="min-w-0 truncate text-sm font-semibold">
                        {node.label}
                      </span>
                    </span>
                    <IconChevronDown className="size-4 shrink-0 rotate-[-90deg] text-muted-foreground" />
                  </span>
                  <span className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {node.description || t("factoryCanvas.addContext")}
                  </span>
                  <span className="mt-auto flex items-center justify-between gap-2 pt-2 text-[11px] text-muted-foreground">
                    <span>
                      {metric.toLocaleString()}{" "}
                      {node.metricsKey
                        ? t("factoryCanvas.signals")
                        : t("factoryCanvas.events")}
                    </span>
                    {comments > 0 && (
                      <span>
                        {comments}{" "}
                        {t(
                          comments === 1
                            ? "factoryCanvas.commentOne"
                            : "factoryCanvas.commentMany",
                        )}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <button
        type="button"
        className="absolute bottom-3 left-3 rounded-md bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow-sm ring-1 ring-border hover:text-foreground"
        onClick={() => onComment("canvas")}
      >
        {t("factoryCanvas.commentFactory")}
      </button>
    </div>
  );
}
