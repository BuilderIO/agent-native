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
  type NodeChange,
} from "@xyflow/react";

import "@xyflow/react/dist/base.css";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import {
  checkConnection,
  firstOpenPort,
  fitNewNodePosition,
  type Rejection,
  type WorkflowEditor,
} from "@/lib/workflow-editor";

import { CanvasTestButton } from "./CanvasTestButton";
import { insertOnEdge, type ProviderLinkStatus } from "./creator/creator-model";
import { NodeCreator, type CreatorTarget } from "./creator/NodeCreator";
import { EdgeToolbar } from "./EdgeToolbar";
import { EmptyCanvasTile } from "./EmptyCanvasTile";
import {
  reconcileNodes,
  toFlowEdges,
  toFlowNodes,
  type WorkflowFlowEdge,
  type WorkflowFlowNode,
} from "./flow-model";
import { NodeHoverToolbar } from "./NodeHoverToolbar";
import type { WorkflowOverlay } from "./overlay";
import type { PaletteEntry } from "./palette";
import { PortPickerContext, type PortTarget } from "./port-picker";
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
  /** A test is starting, so the test button is disabled. */
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
}: WorkflowCanvasProps) {
  const s = useWorkflowCanvasStrings();

  const snapshot = useEditorSnapshot(editor);
  const { graph, selection } = snapshot;
  const validation = editor.validate();
  const flow = useReactFlow<WorkflowFlowNode, WorkflowFlowEdge>();
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingReveal = useRef<string | null>(null);
  const mac = usePrefersMac();
  // The target is kept after closing, so the sheet does not change under its exit animation.
  const [creator, setCreator] = useState<{
    open: boolean;
    target: CreatorTarget;
  }>({ open: false, target: { kind: "append" } });

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
    ],
  );
  const edges = useMemo(
    () => toFlowEdges({ graph, validation, overlay, selection }),
    [graph, validation, overlay, selection],
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
  // The hover toolbar steps aside while a text field has focus, such as a step's name in the settings panel.
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) =>
      setTyping(isEditableTarget(event.target));
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

  const openCreator = useCallback(
    (target: CreatorTarget) => {
      if (!readOnly) setCreator({ open: true, target });
    },
    [readOnly],
  );

  const openPortPicker = useCallback(
    (target: PortTarget) =>
      openCreator({
        kind: "append",
        after: { nodeId: target.node, port: target.port },
      }),
    [openCreator],
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

  // An append goes after the output it was placed on, else after the selected step's first open output.
  // An insert replaces the connection in one edit, so one undo step reverts it, and the new step is selected.
  const pickStep = useCallback(
    (entry: PaletteEntry, target: CreatorTarget) => {
      const { graph: current, selection: picked } = editor.getSnapshot();
      if (target.kind === "insert") {
        const outcome = insertOnEdge(
          current,
          editor.catalog,
          target.edgeId,
          entry.kind,
          entry.options,
        );
        if (!outcome.ok) {
          if ("reason" in outcome) toast.error(s.creator.insertBlockedLoop);
          else reject(outcome.rejection);
          return;
        }
        editor.replaceGraph(outcome.graph, { keepHistory: true });
        editor.select({ nodeIds: [outcome.node.id], edgeIds: [] });
        pendingReveal.current = outcome.node.id;
        return;
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
      const rect = containerRef.current?.getBoundingClientRect();
      const near = rect
        ? flow.screenToFlowPosition({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          })
        : undefined;
      const result = editor.addNode(entry.kind, {
        ...entry.options,
        ...(after
          ? { after }
          : { position: fitNewNodePosition(current, { near }) }),
      });
      if (!result.ok) return reject(result.rejection);
      pendingReveal.current = result.node.id;
    },
    [editor, flow, reject, s],
  );

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

  // So is a selected step, which the settings panel opening beside the canvas can cover.
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

  const runShortcut = useCallback(
    (id: WorkflowShortcutId) => {
      switch (id) {
        case "fit-view":
          return fitView();
        case "select-all":
          return editor.selectAll();
        case "deselect":
          return editor.clearSelection();
        case "undo":
          return readOnly ? undefined : void editor.undo();
        case "redo":
          return readOnly ? undefined : void editor.redo();
        case "delete":
          return readOnly ? undefined : report(editor.deleteSelection());
        case "duplicate":
          return readOnly ? undefined : report(editor.duplicateNodes());
        case "add-step":
          return creator.open ? undefined : openCreator({ kind: "append" });
      }
    },
    [creator.open, editor, fitView, openCreator, readOnly, report],
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
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!engaged.current || isEditableTarget(event.target)) return;
      const inside =
        event.target instanceof Node && container.contains(event.target);
      const idle =
        event.target === document.body ||
        event.target === document.documentElement;
      if (!inside && !idle) return;
      const id = resolveWorkflowShortcut(event);
      if (!id || (id === "add-step" && isControlTarget(event.target))) return;
      event.preventDefault();
      runShortcut(id);
    };
    document.addEventListener("pointerdown", engage, true);
    document.addEventListener("focusin", engage, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", engage, true);
      document.removeEventListener("focusin", engage, true);
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

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={s.canvasName}
      tabIndex={-1}
      className={cn(
        "workflow-canvas relative size-full min-h-64 outline-none",
        className,
      )}
    >
      <WorkflowMarkerDefs />
      <PortPickerContext.Provider value={readOnly ? null : openPortPicker}>
        <ReactFlow<WorkflowFlowNode, WorkflowFlowEdge>
          nodes={ringed}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStart={() => editor.sealHistory()}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
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
          connectionRadius={32}
          connectionDragThreshold={4}
          attributionPosition="bottom-left"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} />
          {minimap && !empty && (
            <MiniMap
              pannable
              zoomable
              position="bottom-right"
              className="!m-3 !h-28 !w-44"
            />
          )}
          {selectedId && !readOnly && !typing && (
            <NodeHoverToolbar
              nodeId={selectedId}
              onTestStep={onTestStep}
              onDuplicate={() => report(editor.duplicateNodes())}
              onDelete={() => report(editor.deleteSelection())}
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
                    onClick={() => {
                      report(editor.autoLayout());
                      requestAnimationFrame(fitView);
                    }}
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
                    disabled={!hasSelection && selection.edgeIds.length === 0}
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
      </PortPickerContext.Provider>
      {!readOnly && (
        <NodeCreator
          catalog={editor.catalog}
          open={creator.open}
          onOpenChange={(open) =>
            setCreator((current) => ({ ...current, open }))
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
              />
            </div>
          )}
        </div>
      )}
    </div>
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
