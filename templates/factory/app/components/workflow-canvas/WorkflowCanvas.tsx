import {
  clampZoomFactor,
  normalizeWheelDeltaPx,
  resolveZoomGestureDevice,
  zoomFactorForWheelDelta,
  type ZoomGestureDevice,
} from "@agent-native/core/client/zoom-gesture";
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconCopy,
  IconFocusCentered,
  IconLayoutDistributeHorizontal,
  IconPlus,
  IconSitemap,
  IconTrash,
  IconZoomIn,
  IconZoomOut,
  type Icon,
} from "@tabler/icons-react";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  getViewportForBounds,
  useNodesInitialized,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type FinalConnectionState,
  type NodeChange,
} from "@xyflow/react";

import "@xyflow/react/dist/base.css";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWorkflowStrings } from "@/components/workflow/workflow-strings";
import { cn } from "@/lib/utils";
import {
  addNode,
  checkConnection,
  createNode,
  firstOpenPort,
  fitNewNodePosition,
  moveNodes,
  nextNodeIdentity,
  nodeSize,
  NODE_TILE_HEIGHT,
  NODE_WIDTH,
  OUT_PORT,
  portsWithLimit,
  type Point,
  type Rejection,
  type Size,
  type WorkflowCatalog,
  type WorkflowEditor,
  type WorkflowGraph,
} from "@/lib/workflow-editor";
import { makeRoomForInsert } from "@/lib/workflow-editor/insert-room";

import { CanvasTestButton } from "./CanvasTestButton";
import { insertOnEdge, type ProviderLinkStatus } from "./creator/creator-model";
import { NodeCreator, type CreatorTarget } from "./creator/NodeCreator";
import {
  EdgeActionsContext,
  EdgeToolbar,
  type EdgeActions,
} from "./EdgeToolbar";
import { EmptyCanvasTile } from "./EmptyCanvasTile";
import {
  reconcileNodes,
  toFlowEdges,
  toFlowNodes,
  type WorkflowFlowEdge,
  type WorkflowFlowNode,
} from "./flow-model";
import {
  canvasMenuEntries,
  ContextMenuEntries,
  stepMenuEntries,
  type MenuEntry,
} from "./NodeContextMenu";
import { NodeHoverToolbar } from "./NodeHoverToolbar";
import type { WorkflowOverlay } from "./overlay";
import type { PaletteEntry } from "./palette";
import {
  resolveWorkflowShortcut,
  shortcutLabel,
  type WorkflowShortcutId,
} from "./shortcuts";
import { useWorkflowCanvasStrings } from "./strings";
import { useEditorSnapshot } from "./use-workflow-editor";
import { BackEdge, ForwardEdge, WorkflowMarkerDefs } from "./WorkflowEdges";
import { WorkflowNodeCard } from "./WorkflowNodeCard";

import "./workflow-canvas.css";

const NODE_TYPES = { workflow: WorkflowNodeCard };
const EDGE_TYPES = { forward: ForwardEdge, back: BackEdge };
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;
const SNAP_GRID: [number, number] = [8, 8];
const FIT_OPTIONS = { padding: 0.2, maxZoom: 1 };
/** Below this, step names are unreadable, so a big graph opens at this zoom from its start instead of fitted whole. */
const READABLE_ZOOM = 0.55;
const START_MARGIN = 48;
const FOCUS_MARGIN = 48;
/** The bottom toolbar floats over the canvas, so a step needs more room above it. */
const FOCUS_MARGIN_BOTTOM = 96;
/** Steps placed after the outputs of one step sit this far apart vertically, so each output's branch has its own row. */
const OUTPUT_ROW = 112;
/** With an even number of outputs, the two nearest the middle sit this far either side of the step's top. */
const OUTPUT_ROW_CENTER = 96;

export interface WorkflowCanvasProps {
  editor: WorkflowEditor;
  readOnly?: boolean;
  overlay?: WorkflowOverlay;
  /** Providers each step needs that are not connected, by node id. */
  unconnected?: Readonly<Record<string, readonly string[]>>;
  minimap?: boolean;
  className?: string;
  /** Called when a command is refused. Defaults to an error toast. */
  onRejection?: (rejection: Rejection) => void;
  /** Extra controls at the end of the bottom toolbar. */
  toolbarEnd?: ReactNode;
  /** Runs a dry test of the workflow. The test button shows on a graph that has steps. */
  onTest?: () => void;
  /** The workflow has unsaved edits, which a test saves first. */
  unsaved?: boolean;
  /** A test or a save is starting, so the test button is disabled. */
  testing?: boolean;
  /** Tests one step. Adds a test action to the selected step's hover toolbar. */
  onTestStep?: (nodeId: string) => void;
  /** Steps the page reports as just added. They get a ring for a moment. */
  recentNodeIds?: ReadonlySet<string>;
  /** Opens the step creator from an empty canvas. Without it, the add tile opens the creator for a first step. */
  onAddFirstStep?: () => void;
  /** Opens the agent sidebar with a request for the workflow, from an empty canvas. */
  onDescribeFirst?: () => void;
  /** Each provider's connection status for this person. A provider left out reads as unknown. */
  connections?: Readonly<Record<string, ProviderLinkStatus>>;
  /** Asks to connect a provider the step creator shows as not connected. Without it, no Connect control shows. */
  onConnectProvider?: (provider: string) => void;
  /** Hands a description the step creator could not match to the agent. Without it, no describe row shows. */
  onDescribeStep?: (query: string) => void;
  /** Opens a step's details; `name` focuses its name field. Without it, Enter, Space and F2 do nothing, and the menus leave out Open details and Rename. */
  onOpenDetails?: (nodeId: string, focus?: "name") => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

/** Buttons and links keep Tab for moving between controls; only the canvas itself takes it for adding a step. */
function isControlTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("button, a[href], [role='toolbar']") !== null
  );
}

/** The id of the step an element sits in. React Flow writes each step's id on its element as `data-id`. */
function stepIdOf(element: Element): string | undefined {
  return element.closest<HTMLElement>(".react-flow__node")?.dataset.id;
}

/** The step one connection upstream: the first forward connection into this step. Back-edges are loops, not steps before this one. */
function firstUpstream(
  graph: WorkflowGraph,
  nodeId: string,
): string | undefined {
  return graph.edges.find((edge) => !edge.back && edge.to.node === nodeId)?.from
    .node;
}

/** The step one connection downstream: the first target of this step's first output that has one. */
function firstDownstream(
  graph: WorkflowGraph,
  nodeId: string,
): string | undefined {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return undefined;
  for (const port of portsWithLimit(graph, node)) {
    const edge = graph.edges.find(
      (candidate) =>
        !candidate.back &&
        candidate.from.node === nodeId &&
        candidate.from.port === port,
    );
    if (edge) return edge.to.node;
  }
  return undefined;
}

/** Every step reachable from this one by forward connections, one way only, not counting the step itself. */
function chainFrom(
  graph: WorkflowGraph,
  nodeId: string,
  direction: "upstream" | "downstream",
): string[] {
  const found: string[] = [];
  const queue = [nodeId];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    for (const edge of graph.edges) {
      if (edge.back) continue;
      const [near, far] =
        direction === "upstream"
          ? [edge.to.node, edge.from.node]
          : [edge.from.node, edge.to.node];
      if (near !== current || far === nodeId || found.includes(far)) continue;
      found.push(far);
      queue.push(far);
    }
  }
  return found;
}

/** Arrow keys that move the selection along the flow. Up and down are listed too: they select nothing, so React Flow does not nudge the step. */
const ARROW_SHORTCUTS = new Set<WorkflowShortcutId>([
  "select-upstream",
  "select-downstream",
  "select-upstream-chain",
  "select-downstream-chain",
  "arrow-up-down",
]);

/** Keys a focused control keeps for itself, so Enter, Space and the rest press the button rather than the canvas. */
const STEP_ASIDE_FOR_CONTROLS = new Set<WorkflowShortcutId>([
  "add-step",
  "open-details",
  "rename",
  "test-workflow",
  "arrange",
]);

/** While the step creator is open, these keys belong to the creator's list and to the step it is for. */
const STAND_DOWN_FOR_CREATOR = new Set<WorkflowShortcutId>([
  "open-details",
  "rename",
  "test-workflow",
  "arrange",
  ...ARROW_SHORTCUTS,
]);

/** How long the hover toolbar stays after the pointer leaves its step, so the pointer can cross the gap. */
const HOVER_LEAVE_MS = 120;

/**
 * How far a step placed after output `index` of `count` outputs shifts up or
 * down. Odd counts have a middle output at 0; even counts have none, so the two
 * nearest the middle sit 96 px either side and each one further out adds a row.
 */
function outputOffset(index: number, count: number): number {
  if (count <= 1) return 0;
  if (count % 2 === 1) return (index - (count - 1) / 2) * OUTPUT_ROW;
  const upper = count / 2 - 1;
  const away = index <= upper ? upper - index : index - upper - 1;
  const distance = OUTPUT_ROW_CENTER + OUTPUT_ROW * away;
  return index <= upper ? -distance : distance;
}

/**
 * Where a step goes after one output: a column right of its source, moved by the
 * output's place among the source's outputs, then pushed down past any step in
 * the way. Undefined when the source is not in the graph; the add then refuses.
 */
function afterOutputPosition(
  graph: WorkflowGraph,
  sourceId: string,
  port: string,
  size: Size,
): Point | undefined {
  const source = graph.nodes.find((node) => node.id === sourceId);
  if (!source) return undefined;
  const ports = portsWithLimit(graph, source);
  // The column comes from the shared placement, so the gap is set in one place.
  const column = fitNewNodePosition(graph, { after: sourceId, size }).x;
  return fitNewNodePosition(graph, {
    near: {
      x: column + size.width / 2,
      y:
        source.position.y +
        outputOffset(ports.indexOf(port), ports.length) +
        size.height / 2,
    },
    size,
  });
}

/** The size a new step will have, from the same creation the editor runs. */
function stepSize(
  graph: WorkflowGraph,
  catalog: WorkflowCatalog,
  entry: PaletteEntry,
): Size {
  const made = createNode(
    entry.kind,
    {
      id: nextNodeIdentity(graph, entry.kind),
      name: nextNodeIdentity(graph, entry.kind),
      position: { x: 0, y: 0 },
    },
    catalog,
    entry.options,
  );
  // A step that cannot be made is refused by the add itself, which says why.
  return made.ok
    ? nodeSize(graph, made.node)
    : { width: NODE_WIDTH, height: NODE_TILE_HEIGHT };
}

/** A drop point is for the one pick it was made for, so closing the panel without a pick forgets it. */
function forgetDropPoint(target: CreatorTarget): CreatorTarget {
  return target.kind === "append" && target.position
    ? { kind: "append", after: target.after }
    : target;
}

/** The pointer's position on screen when a drag ends, from a mouse or a touch. */
function pointerOf(
  event: MouseEvent | TouchEvent,
): { x: number; y: number } | undefined {
  if ("changedTouches" in event) {
    const touch = event.changedTouches.item(0);
    return touch ? { x: touch.clientX, y: touch.clientY } : undefined;
  }
  return { x: event.clientX, y: event.clientY };
}

function usePrefersMac(): boolean {
  const [mac, setMac] = useState(false);
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
  }, []);
  return mac;
}

function ToolbarButton({
  icon: ButtonIcon,
  label,
  shortcut,
  onClick,
  disabled,
}: {
  icon: Icon;
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          <ButtonIcon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut ? (
          <span className="ms-2 text-muted-foreground">{shortcut}</span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

function CanvasInner({
  editor,
  readOnly = false,
  overlay,
  unconnected,
  minimap = false,
  className,
  onRejection,
  toolbarEnd,
  onTest,
  unsaved = false,
  testing = false,
  onTestStep,
  recentNodeIds,
  onAddFirstStep,
  onDescribeFirst,
  connections,
  onConnectProvider,
  onDescribeStep,
  onOpenDetails,
}: WorkflowCanvasProps) {
  const s = useWorkflowCanvasStrings();
  const ws = useWorkflowStrings();

  const snapshot = useEditorSnapshot(editor);
  const { graph, selection } = snapshot;
  const validation = editor.validate();
  const flow = useReactFlow<WorkflowFlowNode, WorkflowFlowEdge>();
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingReveal = useRef<string | null>(null);
  const mac = usePrefersMac();
  // The target is kept after closing, so the panel does not change under its exit animation.
  const [creator, setCreator] = useState<{
    open: boolean;
    target: CreatorTarget;
  }>({ open: false, target: { kind: "append" } });
  // The connection under the pointer rises above its neighbours while it is hovered.
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | undefined>(
    undefined,
  );
  // The step the pointer is over, and the one keyboard focus is on. Either shows its hover toolbar.
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  // The step whose More menu is open, so its toolbar stays up while the menu is.
  const [moreNodeId, setMoreNodeId] = useState<string | null>(null);
  // Which menu a right-click opened: a step's, or the canvas's.
  const [menu, setMenu] = useState<"step" | "canvas" | null>(null);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  // Leaving a step waits a moment, so the pointer can cross the gap to its toolbar. Entering one cancels the wait.
  const holdHover = useCallback((nodeId: string | null) => {
    window.clearTimeout(hoverTimer.current);
    if (nodeId) setHoveredNodeId(nodeId);
    else
      hoverTimer.current = window.setTimeout(
        () => setHoveredNodeId(null),
        HOVER_LEAVE_MS,
      );
  }, []);

  const reject = useCallback(
    (rejection: Rejection) => {
      if (onRejection) onRejection(rejection);
      else toast.error(s.rejection[rejection.code]);
    },
    [onRejection, s],
  );
  const report = useCallback(
    (outcome: { ok: boolean; rejection?: Rejection }) => {
      if (!outcome.ok && outcome.rejection) reject(outcome.rejection);
    },
    [reject],
  );

  const openCreator = useCallback(
    (target: CreatorTarget) => {
      if (!readOnly) setCreator({ open: true, target });
    },
    [readOnly],
  );
  // The plus on an unconnected output opens the panel after that output.
  const addAfterOutput = useCallback(
    (nodeId: string, port: string) =>
      openCreator({ kind: "append", after: { nodeId, port } }),
    [openCreator],
  );

  const desiredNodes = useMemo(
    () =>
      toFlowNodes({
        graph,
        catalog: editor.catalog,
        validation,
        overlay,
        unconnected,
        selection,
        readOnly,
        strings: s,
        onAddAfter: readOnly ? undefined : addAfterOutput,
      }),
    [
      graph,
      editor.catalog,
      validation,
      overlay,
      unconnected,
      selection,
      readOnly,
      s,
      addAfterOutput,
    ],
  );
  const edges = useMemo(
    () => toFlowEdges({ graph, validation, overlay, selection, hoveredEdgeId }),
    [graph, validation, overlay, selection, hoveredEdgeId],
  );
  // React Flow owns measured sizes and in-flight drag positions, so the nodes it
  // renders live in state and are rebuilt from the graph around that.
  const [nodes, setNodes] = useState<WorkflowFlowNode[]>(desiredNodes);
  useEffect(() => {
    setNodes((previous) => reconcileNodes(previous, desiredNodes));
  }, [desiredNodes]);
  // Steps the page reports as just added are ringed, in the same token as selection.
  const ringed = useMemo(
    () =>
      recentNodeIds && recentNodeIds.size > 0
        ? nodes.map((node) =>
            recentNodeIds.has(node.id)
              ? {
                  ...node,
                  className: cn(
                    node.className,
                    "rounded-lg ring-2 ring-primary",
                  ),
                }
              : node,
          )
        : nodes,
    [nodes, recentNodeIds],
  );
  // The hover toolbar steps aside while a text field has focus, such as a step's name in its details dialog.
  // Focus on a step shows that step's toolbar; focus on the canvas's other parts, or outside it, clears it.
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      setTyping(isEditableTarget(target));
      // The toolbar's own buttons keep the step they belong to.
      if (
        !(target instanceof Element) ||
        target.closest(".workflow-step-toolbar")
      ) {
        return;
      }
      const step =
        containerRef.current?.contains(target) === true
          ? stepIdOf(target)
          : undefined;
      setFocusedNodeId(step ?? null);
    };
    const onFocusOut = () => setTyping(false);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange<WorkflowFlowNode>[]) => {
      setNodes((current) =>
        applyNodeChanges(
          changes.filter((change) => change.type !== "remove"),
          current,
        ),
      );
      const picks = changes.filter((change) => change.type === "select");
      if (picks.length > 0) {
        const { selection: current } = editor.getSnapshot();
        const ids = new Set(current.nodeIds);
        for (const pick of picks) {
          if (pick.selected) ids.add(pick.id);
          else ids.delete(pick.id);
        }
        editor.select({ nodeIds: [...ids], edgeIds: current.edgeIds });
      }
      // A drag, or an arrow key on a focused node, reports where nodes ended up.
      const moved: Record<string, { x: number; y: number }> = {};
      for (const change of changes) {
        if (
          change.type === "position" &&
          change.dragging === false &&
          change.position
        ) {
          moved[change.id] = change.position;
        }
      }
      if (Object.keys(moved).length > 0 && !readOnly) {
        report(editor.moveNodes(moved, { key: "canvas-move", windowMs: 400 }));
      }
    },
    [editor, readOnly, report],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<WorkflowFlowEdge>[]) => {
      const picks = changes.filter((change) => change.type === "select");
      if (picks.length === 0) return;
      const { selection: current } = editor.getSnapshot();
      const ids = new Set(current.edgeIds);
      for (const pick of picks) {
        if (pick.selected) ids.add(pick.id);
        else ids.delete(pick.id);
      }
      editor.select({ nodeIds: current.nodeIds, edgeIds: [...ids] });
    },
    [editor],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      report(
        editor.connect(
          { node: connection.source, port: connection.sourceHandle ?? "out" },
          connection.target,
          { back: "auto" },
        ),
      );
    },
    [editor, report],
  );

  const isValidConnection = useCallback(
    (connection: {
      source: string;
      target: string;
      sourceHandle?: string | null;
    }) =>
      checkConnection(
        editor.getSnapshot().graph,
        { node: connection.source, port: connection.sourceHandle ?? "out" },
        connection.target,
      ).ok,
    [editor],
  );

  const openInsertOnEdge = useCallback(
    (edgeId: string) => {
      // A loop's back-edge cannot take a step, so the creator is not opened for it.
      const edge = editor
        .getSnapshot()
        .graph.edges.find((candidate) => candidate.id === edgeId);
      if (edge?.back) {
        toast.error(s.creator.insertBlockedLoop);
        return;
      }
      openCreator({ kind: "insert", edgeId });
    },
    [editor, openCreator, s],
  );

  const removeConnection = useCallback(
    (edgeId: string) => report(editor.disconnect(edgeId)),
    [editor, report],
  );
  const edgeActions = useMemo<EdgeActions>(
    () => ({
      onInsertOnEdge: openInsertOnEdge,
      onRemoveEdge: removeConnection,
    }),
    [openInsertOnEdge, removeConnection],
  );

  // A drag from an output that no input took opens the panel after that output, at the release point.
  // A release on a plus button is that button's click, so it opens nothing.
  const dropOnEmptyCanvas = useCallback(
    (event: MouseEvent | TouchEvent, connection: FinalConnectionState) => {
      if (connection.isValid) return;
      const { fromNode, fromHandle } = connection;
      const pointer = pointerOf(event);
      if (!fromNode || !fromHandle?.id || !pointer) return;
      if (
        document
          .elementFromPoint(pointer.x, pointer.y)
          ?.closest(".workflow-plus")
      ) {
        return;
      }
      openCreator({
        kind: "append",
        after: { nodeId: fromNode.id, port: fromHandle.id },
        position: flow.screenToFlowPosition(pointer),
      });
    },
    [flow, openCreator],
  );

  // The middle of the visible canvas, in flow coordinates: where a step lands when nothing else places it.
  function viewCenter(): Point | undefined {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return undefined;
    return flow.screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  }

  // The step goes one column right of the source, on the source's top, and the steps in its way move right first.
  // The whole edit is one undo step, so one undo puts the connection back.
  function pickOnEdge(entry: PaletteEntry, edgeId: string) {
    const { graph: current } = editor.getSnapshot();
    const edge = current.edges.find((candidate) => candidate.id === edgeId);
    const source = current.nodes.find((node) => node.id === edge?.from.node);
    if (!edge || !source) {
      return reject({ code: "unknown_edge", message: `No edge "${edgeId}".` });
    }
    const outcome = insertOnEdge(
      current,
      editor.catalog,
      edgeId,
      entry.kind,
      entry.options,
    );
    if (!outcome.ok) {
      if ("reason" in outcome) toast.error(s.creator.insertBlockedLoop);
      else reject(outcome.rejection);
      return;
    }
    const insertLeft: Point = {
      x: fitNewNodePosition(current, { after: source.id }).x,
      y: source.position.y,
    };
    const room = makeRoomForInsert(
      current,
      source.id,
      insertLeft,
      nodeSize(outcome.graph, outcome.node),
    );
    const placed = moveNodes(outcome.graph, {
      ...room,
      [outcome.node.id]: insertLeft,
    });
    if (!placed.ok) return reject(placed.rejection);
    editor.replaceGraph(placed.graph, { keepHistory: true });
    editor.select({ nodeIds: [outcome.node.id], edgeIds: [] });
    pendingReveal.current = outcome.node.id;
    onOpenDetails?.(outcome.node.id);
  }

  // An append goes after an output: the drop point of a drag, else the output a plus was on, else the selected
  // step's first open output. Anything else lands in the middle of the view, unconnected.
  function pickAppended(
    entry: PaletteEntry,
    target: Extract<CreatorTarget, { kind: "append" }>,
  ) {
    const { graph: current, selection: picked } = editor.getSnapshot();
    if (current.nodes.length === 0 && entry.kind !== "trigger") {
      return pickFirstStep(entry);
    }
    const anchor =
      picked.nodeIds.length === 1 && entry.kind !== "trigger"
        ? picked.nodeIds[0]
        : undefined;
    const port = anchor ? firstOpenPort(current, anchor) : undefined;
    const after = target.after
      ? { node: target.after.nodeId, port: target.after.port }
      : anchor && port
        ? { node: anchor, port }
        : undefined;
    const size = stepSize(current, editor.catalog, entry);
    let position: Point | undefined;
    if (!after) {
      position = fitNewNodePosition(current, { near: viewCenter() });
    } else if (target.position) {
      // A drop puts the step's left edge at the pointer and its middle on it, with no push-down.
      position = {
        x: target.position.x,
        y: target.position.y - size.height / 2,
      };
    } else if (target.after) {
      position = afterOutputPosition(current, after.node, after.port, size);
    }
    const result = editor.addNode(entry.kind, {
      ...entry.options,
      ...(after ? { after } : {}),
      ...(position ? { position } : {}),
    });
    if (!result.ok) return reject(result.rejection);
    pendingReveal.current = result.node.id;
    onOpenDetails?.(result.node.id);
  }

  // The first step on an empty canvas comes after the default schedule trigger, because a workflow has exactly one.
  // The pair is one undo step.
  function pickFirstStep(entry: PaletteEntry) {
    const { graph: current } = editor.getSnapshot();
    const starter = addNode(current, editor.catalog, "trigger", {
      position: fitNewNodePosition(current, { near: viewCenter() }),
    });
    if (!starter.ok) return reject(starter.rejection);
    const step = addNode(starter.graph, editor.catalog, entry.kind, {
      ...entry.options,
      after: { node: starter.node.id, port: OUT_PORT },
    });
    if (!step.ok) return reject(step.rejection);
    editor.replaceGraph(step.graph, { keepHistory: true });
    editor.select({ nodeIds: [step.node.id], edgeIds: [] });
    pendingReveal.current = step.node.id;
    onOpenDetails?.(step.node.id);
  }

  function pickStep(entry: PaletteEntry, target: CreatorTarget) {
    if (target.kind === "insert") pickOnEdge(entry, target.edgeId);
    else pickAppended(entry, target);
  }

  // Pans so a step is on screen, if it is not already. Reports false while the
  // step has not been measured yet.
  const reveal = useCallback(
    (id: string): boolean => {
      const rect = containerRef.current?.getBoundingClientRect();
      const internal = flow.getInternalNode(id);
      if (!rect || !internal || !internal.measured.width) return false;
      const { x, y, zoom } = flow.getViewport();
      const at = internal.internals.positionAbsolute;
      const width = internal.measured.width;
      const height = internal.measured.height ?? 0;
      const left = at.x * zoom + x;
      const top = at.y * zoom + y;
      const visible =
        left >= FOCUS_MARGIN &&
        top >= FOCUS_MARGIN &&
        left + width * zoom <= rect.width - FOCUS_MARGIN &&
        top + height * zoom <= rect.height - FOCUS_MARGIN_BOTTOM;
      if (visible) return true;
      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      void flow.setCenter(at.x + width / 2, at.y + height / 2, {
        zoom,
        duration: reduced ? 0 : 250,
      });
      return true;
    },
    [flow],
  );

  // React Flow's own `fitView` prop fits before sizes are known and lands on the
  // minimum zoom, so the first view waits until every node is measured.
  const measured = useNodesInitialized();
  const fitted = useRef(false);
  useEffect(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!measured || fitted.current || !rect) return;
    fitted.current = true;
    const bounds = flow.getNodesBounds(flow.getNodes());
    const whole = getViewportForBounds(
      bounds,
      rect.width,
      rect.height,
      MIN_ZOOM,
      FIT_OPTIONS.maxZoom,
      FIT_OPTIONS.padding,
    );
    void flow.setViewport(
      whole.zoom >= READABLE_ZOOM
        ? whole
        : {
            zoom: READABLE_ZOOM,
            x: START_MARGIN - bounds.x * READABLE_ZOOM,
            y: rect.height / 2 - (bounds.y + bounds.height / 2) * READABLE_ZOOM,
          },
    );
    const first = editor.getSnapshot().selection.nodeIds[0];
    if (first) requestAnimationFrame(() => reveal(first));
  }, [measured, flow, editor, reveal]);

  // A step the user just added is brought into view once it is measured.
  useEffect(() => {
    const id = pendingReveal.current;
    if (id && reveal(id)) pendingReveal.current = null;
  }, [nodes, reveal]);

  // So is a selected step, which the creator panel opening beside the canvas can cover.
  const selectedId =
    selection.nodeIds.length === 1 ? selection.nodeIds[0] : undefined;
  useEffect(() => {
    if (selectedId && fitted.current) reveal(selectedId);
  }, [selectedId, reveal]);

  // Pinch and Cmd/Ctrl+wheel zoom with the same math the other canvases use;
  // a plain wheel pans through React Flow's `panOnScroll`.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let device: ZoomGestureDevice | null = null;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      device = resolveZoomGestureDevice({
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        atMs: event.timeStamp,
        previous: device,
      });
      const factor = clampZoomFactor(
        zoomFactorForWheelDelta(
          normalizeWheelDeltaPx(event.deltaY, event.deltaMode),
          device.pinch,
        ),
      );
      const { x, y, zoom } = flow.getViewport();
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
      const rect = container.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const ratio = next / zoom;
      void flow.setViewport({
        x: px - (px - x) * ratio,
        y: py - (py - y) * ratio,
        zoom: next,
      });
    };
    container.addEventListener("wheel", onWheel, {
      passive: false,
      capture: true,
    });
    return () => container.removeEventListener("wheel", onWheel, true);
  }, [flow]);

  const fitView = useCallback(
    () => void flow.fitView({ ...FIT_OPTIONS, duration: 200 }),
    [flow],
  );

  // Arranges the steps and fits them in view, as the toolbar's arrange button and the Shift+Alt+T shortcut do.
  const tidyUp = useCallback(() => {
    report(editor.autoLayout());
    requestAnimationFrame(fitView);
  }, [editor, fitView, report]);

  // A step acted on from its own toolbar or menu is selected first, unless it is already part of the selection.
  const ensureSelected = useCallback(
    (nodeId: string) => {
      if (!editor.getSnapshot().selection.nodeIds.includes(nodeId)) {
        editor.select({ nodeIds: [nodeId], edgeIds: [] });
      }
    },
    [editor],
  );

  // Returns whether the key did something, so the browser's own action is only stopped when it did.
  const runShortcut = useCallback(
    (id: WorkflowShortcutId): boolean => {
      const { graph: current, selection: picked } = editor.getSnapshot();
      if (creator.open && STAND_DOWN_FOR_CREATOR.has(id)) return false;
      const onlyStep =
        picked.nodeIds.length === 1 ? picked.nodeIds[0] : undefined;
      switch (id) {
        case "fit-view":
          fitView();
          return true;
        case "select-all":
          editor.selectAll();
          return true;
        case "deselect":
          editor.clearSelection();
          return true;
        case "undo":
          if (!readOnly) editor.undo();
          return true;
        case "redo":
          if (!readOnly) editor.redo();
          return true;
        case "delete":
          if (!readOnly) report(editor.deleteSelection());
          return true;
        case "duplicate":
          if (!readOnly) report(editor.duplicateNodes());
          return true;
        case "add-step":
          if (!creator.open) openCreator({ kind: "append" });
          return true;
        case "zoom-in":
          void flow.zoomIn({ duration: 150 });
          return true;
        case "zoom-out":
          void flow.zoomOut({ duration: 150 });
          return true;
        case "arrange":
          if (readOnly || current.nodes.length === 0) return false;
          tidyUp();
          return true;
        case "open-details":
          if (!onOpenDetails || !onlyStep) return false;
          onOpenDetails(onlyStep);
          return true;
        case "rename":
          if (readOnly || !onOpenDetails || !onlyStep) return false;
          onOpenDetails(onlyStep, "name");
          return true;
        case "test-workflow":
          if (readOnly || !onTest || testing || current.nodes.length === 0) {
            return false;
          }
          onTest();
          return true;
        case "select-upstream":
        case "select-downstream":
        case "select-upstream-chain":
        case "select-downstream-chain": {
          if (!onlyStep) return false;
          const upstream =
            id === "select-upstream" || id === "select-upstream-chain";
          if (id.endsWith("chain")) {
            const more = chainFrom(
              current,
              onlyStep,
              upstream ? "upstream" : "downstream",
            );
            editor.select({ nodeIds: [onlyStep, ...more], edgeIds: [] });
          } else {
            const next = upstream
              ? firstUpstream(current, onlyStep)
              : firstDownstream(current, onlyStep);
            if (next) editor.select({ nodeIds: [next], edgeIds: [] });
          }
          return true;
        }
        // Up and down select nothing, and the step stays where it is.
        case "arrow-up-down":
          return onlyStep !== undefined;
      }
    },
    [
      creator.open,
      editor,
      fitView,
      flow,
      onOpenDetails,
      onTest,
      openCreator,
      readOnly,
      report,
      testing,
      tidyUp,
    ],
  );

  // Shortcuts listen on the document, because deleting the focused step leaves
  // focus on the page body. They apply once the canvas has been used, and never
  // while typing in a field or inside a menu that renders outside the canvas.
  const engaged = useRef(false);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const engage = (event: Event) => {
      engaged.current =
        event.target instanceof Node && container.contains(event.target);
    };
    // Keys reach the canvas from the canvas, from its steps, or from the page body: never from a field or a control.
    const reachesCanvas = (target: EventTarget | null) => {
      if (!engaged.current || isEditableTarget(target)) return false;
      const inside = target instanceof Node && container.contains(target);
      const idle =
        target === document.body || target === document.documentElement;
      return inside || idle;
    };
    // Arrow keys run in the capture phase. React Flow moves a focused step on its own arrow keys from a listener
    // below this one, so stopping the key here keeps the step where it is.
    const onArrowKey = (event: globalThis.KeyboardEvent) => {
      if (!reachesCanvas(event.target) || isControlTarget(event.target)) return;
      const id = resolveWorkflowShortcut(event);
      if (!id || !ARROW_SHORTCUTS.has(id)) return;
      if (!runShortcut(id)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!reachesCanvas(event.target)) return;
      const id = resolveWorkflowShortcut(event);
      if (!id || ARROW_SHORTCUTS.has(id)) return;
      if (STEP_ASIDE_FOR_CONTROLS.has(id) && isControlTarget(event.target)) {
        return;
      }
      if (runShortcut(id)) event.preventDefault();
    };
    document.addEventListener("pointerdown", engage, true);
    document.addEventListener("focusin", engage, true);
    document.addEventListener("keydown", onArrowKey, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", engage, true);
      document.removeEventListener("focusin", engage, true);
      document.removeEventListener("keydown", onArrowKey, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [runShortcut]);

  const selectedEdge =
    selection.edgeIds.length === 1 && selection.nodeIds.length === 0
      ? graph.edges.find((edge) => edge.id === selection.edgeIds[0])
      : undefined;
  const hasSelection = selection.nodeIds.length > 0;
  const empty = graph.nodes.length === 0;
  const hasTrigger = graph.nodes.some((node) => node.kind === "trigger");

  // The step whose More menu is open keeps its toolbar; otherwise the pointer's step, then keyboard focus's, then the selected one.
  const candidateNodeId =
    moreNodeId ?? hoveredNodeId ?? focusedNodeId ?? selectedId ?? null;
  const toolbarNodeId =
    candidateNodeId !== null &&
    graph.nodes.some((node) => node.id === candidateNodeId)
      ? candidateNodeId
      : null;

  // Right-click picks the menu by what is under the pointer. Over a step, the step is selected first unless it is
  // already in the selection. Over the panels, no menu opens, and the browser's own menu stays shut too.
  const openMenuAt = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target;
    const step = target instanceof Element ? stepIdOf(target) : undefined;
    if (step) {
      ensureSelected(step);
      setMenu("step");
    } else if (
      target instanceof Element &&
      target.closest(".react-flow__pane, .react-flow__edge")
    ) {
      setMenu("canvas");
    } else {
      event.preventDefault();
      setMenu(null);
    }
  };

  // A double-click opens the step's details, unless it lands on one of the step's own controls.
  const openDetailsOnDoubleClick = useCallback(
    (event: ReactMouseEvent, node: WorkflowFlowNode) => {
      if (!onOpenDetails) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          "button, a, input, textarea, select, .react-flow__handle",
        )
      ) {
        return;
      }
      onOpenDetails(node.id);
    },
    [onOpenDetails],
  );

  const stepEntries = stepMenuEntries({
    count: selection.nodeIds.length,
    readOnly,
    s,
    testStepLabel: ws.nodePanel.testStep,
    shortcut: (id) => shortcutLabel(id, mac),
    openDetails:
      onOpenDetails && selectedId
        ? (focus) => onOpenDetails(selectedId, focus)
        : undefined,
    testStep:
      onTestStep && selectedId ? () => onTestStep(selectedId) : undefined,
    duplicate: () => report(editor.duplicateNodes()),
    remove: () => report(editor.deleteSelection()),
    selectAll: () => editor.selectAll(),
    clearSelection: () => editor.clearSelection(),
  });
  const canvasEntries = canvasMenuEntries({
    readOnly,
    empty,
    hasSelection,
    s,
    shortcut: (id) => shortcutLabel(id, mac),
    addStep: () => openCreator({ kind: "append" }),
    arrange: tidyUp,
    selectAll: () => editor.selectAll(),
    clearSelection: () => editor.clearSelection(),
  });
  const menuEntries: MenuEntry[] =
    menu === "step" ? stepEntries : menu === "canvas" ? canvasEntries : [];

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onContextMenu={openMenuAt}>
        <div
          ref={containerRef}
          role="region"
          aria-label={s.canvasName}
          tabIndex={-1}
          onMouseLeave={() => holdHover(null)}
          className={cn(
            "workflow-canvas relative size-full min-h-64 outline-none",
            className,
          )}
        >
          <WorkflowMarkerDefs />
          <EdgeActionsContext.Provider value={readOnly ? null : edgeActions}>
            <ReactFlow<WorkflowFlowNode, WorkflowFlowEdge>
              nodes={ringed}
              edges={edges}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeDragStart={() => editor.sealHistory()}
              onConnect={onConnect}
              onConnectEnd={dropOnEmptyCanvas}
              isValidConnection={isValidConnection}
              onEdgeMouseEnter={(_event, edge) => setHoveredEdgeId(edge.id)}
              onEdgeMouseLeave={() => setHoveredEdgeId(undefined)}
              onNodeMouseEnter={(_event, node) => holdHover(node.id)}
              onNodeMouseLeave={() => holdHover(null)}
              onNodeDoubleClick={openDetailsOnDoubleClick}
              onPaneClick={() =>
                containerRef.current?.focus({ preventScroll: true })
              }
              nodesDraggable={!readOnly}
              nodesConnectable={!readOnly}
              elementsSelectable
              edgesFocusable
              deleteKeyCode={null}
              selectionKeyCode="Shift"
              panOnScroll
              zoomOnScroll={false}
              zoomOnDoubleClick={false}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              snapToGrid
              snapGrid={SNAP_GRID}
              connectionRadius={60}
              connectionDragThreshold={4}
              connectOnClick={false}
              attributionPosition="bottom-left"
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={20}
                size={1.5}
              />
              {minimap && !empty && (
                <MiniMap
                  pannable
                  zoomable
                  position="bottom-right"
                  className="!m-3 !h-28 !w-44"
                />
              )}
              {toolbarNodeId && !readOnly && !typing && (
                <NodeHoverToolbar
                  nodeId={toolbarNodeId}
                  menu={stepEntries}
                  menuOpen={moreNodeId === toolbarNodeId}
                  onMenuOpenChange={(open) => {
                    if (open) ensureSelected(toolbarNodeId);
                    setMoreNodeId(open ? toolbarNodeId : null);
                  }}
                  onTestStep={onTestStep}
                  onDuplicate={() => {
                    ensureSelected(toolbarNodeId);
                    report(editor.duplicateNodes());
                  }}
                  onDelete={() => {
                    ensureSelected(toolbarNodeId);
                    report(editor.deleteSelection());
                  }}
                  onHoverChange={(over) =>
                    holdHover(over ? toolbarNodeId : null)
                  }
                />
              )}
              {onTest && !readOnly && !empty && (
                <Panel position="bottom-center" className="!mb-16">
                  <CanvasTestButton
                    label={
                      unsaved
                        ? s.canvasActions.saveAndTestWorkflow
                        : s.canvasActions.testWorkflow
                    }
                    disabled={testing}
                    testing={testing}
                    onTest={onTest}
                  />
                </Panel>
              )}
              {selectedEdge && !readOnly && (
                <Panel position="top-center">
                  <EdgeToolbar
                    editor={editor}
                    edge={selectedEdge}
                    onRejection={reject}
                    onInsert={openInsertOnEdge}
                  />
                </Panel>
              )}
              <Panel position="bottom-center" className="!mb-4">
                <div
                  role="toolbar"
                  aria-label={s.canvasName}
                  className="flex max-w-md items-center gap-0.5 overflow-x-auto rounded-lg border border-border bg-card p-1 shadow-sm"
                >
                  {!readOnly && (
                    <>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openCreator({ kind: "append" })}
                          >
                            <IconPlus />
                            {s.toolbar.addStep}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {s.toolbar.addStep}
                          <span className="ms-2 text-muted-foreground">
                            {shortcutLabel("add-step", mac)}
                          </span>
                        </TooltipContent>
                      </Tooltip>
                      <Separator orientation="vertical" className="mx-1 h-5" />
                      <ToolbarButton
                        icon={IconArrowBackUp}
                        label={s.toolbar.undo}
                        shortcut={shortcutLabel("undo", mac)}
                        disabled={!snapshot.canUndo}
                        onClick={() => editor.undo()}
                      />
                      <ToolbarButton
                        icon={IconArrowForwardUp}
                        label={s.toolbar.redo}
                        shortcut={shortcutLabel("redo", mac)}
                        disabled={!snapshot.canRedo}
                        onClick={() => editor.redo()}
                      />
                      <ToolbarButton
                        icon={IconLayoutDistributeHorizontal}
                        label={s.toolbar.arrange}
                        disabled={empty}
                        onClick={tidyUp}
                      />
                      <ToolbarButton
                        icon={IconCopy}
                        label={s.toolbar.duplicate}
                        shortcut={shortcutLabel("duplicate", mac)}
                        disabled={!hasSelection}
                        onClick={() => report(editor.duplicateNodes())}
                      />
                      <ToolbarButton
                        icon={IconTrash}
                        label={s.toolbar.delete}
                        shortcut={shortcutLabel("delete", mac)}
                        disabled={
                          !hasSelection && selection.edgeIds.length === 0
                        }
                        onClick={() => report(editor.deleteSelection())}
                      />
                      <Separator orientation="vertical" className="mx-1 h-5" />
                    </>
                  )}
                  <ToolbarButton
                    icon={IconZoomOut}
                    label={s.toolbar.zoomOut}
                    onClick={() => void flow.zoomOut({ duration: 150 })}
                  />
                  <ToolbarButton
                    icon={IconZoomIn}
                    label={s.toolbar.zoomIn}
                    onClick={() => void flow.zoomIn({ duration: 150 })}
                  />
                  <ToolbarButton
                    icon={IconFocusCentered}
                    label={s.toolbar.fitView}
                    shortcut={shortcutLabel("fit-view", mac)}
                    onClick={fitView}
                  />
                  {toolbarEnd}
                </div>
              </Panel>
            </ReactFlow>
          </EdgeActionsContext.Provider>
          {!readOnly && (
            <NodeCreator
              catalog={editor.catalog}
              open={creator.open}
              onOpenChange={(open) =>
                setCreator((current) => ({
                  open,
                  target: open
                    ? current.target
                    : forgetDropPoint(current.target),
                }))
              }
              target={creator.target}
              hasTrigger={hasTrigger}
              connections={connections}
              onPick={(entry) => pickStep(entry, creator.target)}
              onDescribe={onDescribeStep}
              onConnect={onConnectProvider}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                containerRef.current?.focus({ preventScroll: true });
              }}
            />
          )}
          {empty && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              {readOnly ? (
                <Empty className="max-w-sm flex-none">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <IconSitemap />
                    </EmptyMedia>
                    <EmptyTitle>{s.empty.none}</EmptyTitle>
                  </EmptyHeader>
                </Empty>
              ) : (
                <div className="pointer-events-auto relative">
                  <EmptyCanvasTile
                    onAddFirstStep={
                      onAddFirstStep ?? (() => openCreator({ kind: "append" }))
                    }
                    onDescribe={onDescribeFirst}
                    addActive={creator.open}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuEntries entries={menuEntries} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** The graph editor. Give it an editor from `useWorkflowEditor`; it fills the space its parent gives it. */
export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <ReactFlowProvider>
        <CanvasInner {...props} />
      </ReactFlowProvider>
    </TooltipProvider>
  );
}
