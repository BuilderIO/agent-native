import {
  addNode,
  connect,
  deleteElements,
  disconnect,
  duplicateNodes,
  moveNodes,
  renameNode,
  setBackEdge,
  updateNodeSettings,
} from "./commands.js";
import type {
  NodeKind,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeSettings,
} from "./engine.js";
import {
  createEditHistory,
  DEFAULT_HISTORY_LIMIT,
  type Coalesce,
  type HistoryLabel,
  type Snapshot,
} from "./history.js";
import { layoutGraph } from "./layout.js";
import {
  getSelectionContext,
  pruneSelection,
  sameSelection,
} from "./selection.js";
import {
  EMPTY_SELECTION,
  type BackEdgeInput,
  type EditorValidation,
  type GraphEdit,
  type NewNodeOptions,
  type NodeReference,
  type Outcome,
  type Point,
  type Selection,
  type SelectionContext,
  type WorkflowCatalog,
} from "./types.js";
import { validateEditorGraph } from "./validation.js";

export interface EditorSnapshot {
  graph: WorkflowGraph;
  selection: Selection;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: HistoryLabel | undefined;
  redoLabel: HistoryLabel | undefined;
}

/** `external` marks a graph the editor was handed, such as an agent edit or a restored version. */
export type ChangeSource = "edit" | "undo" | "redo" | "external";

interface WorkflowEditorOptions {
  graph: WorkflowGraph;
  catalog: WorkflowCatalog;
  selection?: Selection;
  historyLimit?: number;
  now?: () => number;
}

export interface WorkflowEditor {
  readonly catalog: WorkflowCatalog;
  getSnapshot: () => EditorSnapshot;
  subscribe: (listener: () => void) => () => void;
  /** Called after every change to the graph, with where the change came from. */
  onGraphChange(
    listener: (graph: WorkflowGraph, source: ChangeSource) => void,
  ): () => void;

  addNode(
    kind: NodeKind,
    options?: NewNodeOptions,
  ): Outcome<{ node: WorkflowNode; edge?: WorkflowEdge }>;
  deleteElements(ids?: Partial<Selection>): Outcome<{
    removedNodeIds: string[];
    removedEdgeIds: string[];
  }>;
  /** Deletes what is selected. */
  deleteSelection(): Outcome<{
    removedNodeIds: string[];
    removedEdgeIds: string[];
  }>;
  duplicateNodes(
    nodeIds?: readonly string[],
  ): Outcome<{ nodes: WorkflowNode[]; skipped: string[] }>;
  moveNodes(positions: Record<string, Point>, coalesce?: Coalesce): Outcome;
  renameNode(
    nodeId: string,
    name: string,
  ): Outcome<{ references: NodeReference[] }>;
  connect(
    from: { node: string; port: string },
    toNode: string,
    options?: { back?: BackEdgeInput | "auto" },
  ): Outcome<{ edge: WorkflowEdge }>;
  disconnect(edgeId: string): Outcome<{ removedEdgeIds: string[] }>;
  setBackEdge(
    edgeId: string,
    back: BackEdgeInput | null,
  ): Outcome<{ prunedEdgeIds: string[] }>;
  updateNodeSettings(
    nodeId: string,
    settings: WorkflowNodeSettings,
    coalesce?: Coalesce,
  ): Outcome<{ node: WorkflowNode; prunedEdgeIds: string[] }>;
  autoLayout(): Outcome;

  select(selection: Partial<Selection>): void;
  selectAll(): void;
  clearSelection(): void;

  undo(): boolean;
  redo(): boolean;
  /** Ends any fold in progress, so the next edit is its own undo step. */
  sealHistory(): void;

  /**
   * Swaps in a graph from outside, such as an agent edit or a restored
   * version. History is cleared by default because its snapshots describe
   * a graph that is gone; pass `keepHistory` to record the swap as one step.
   */
  replaceGraph(graph: WorkflowGraph, options?: { keepHistory?: boolean }): void;

  validate(): EditorValidation;
  getSelectionContext(): SelectionContext;
}

export function createWorkflowEditor(
  options: WorkflowEditorOptions,
): WorkflowEditor {
  const { catalog } = options;
  const history = createEditHistory(
    options.historyLimit ?? DEFAULT_HISTORY_LIMIT,
    options.now,
  );
  let graph = options.graph;
  let selection = pruneSelection(graph, options.selection ?? EMPTY_SELECTION);
  let snapshot = buildSnapshot();
  let validation: { graph: WorkflowGraph; value: EditorValidation } | null =
    null;
  const listeners = new Set<() => void>();
  const graphListeners = new Set<
    (graph: WorkflowGraph, source: ChangeSource) => void
  >();

  function buildSnapshot(): EditorSnapshot {
    return {
      graph,
      selection,
      canUndo: history.canUndo(),
      canRedo: history.canRedo(),
      undoLabel: history.nextUndoLabel(),
      redoLabel: history.nextRedoLabel(),
    };
  }

  function publish(graphChanged: ChangeSource | null) {
    snapshot = buildSnapshot();
    for (const listener of [...listeners]) listener();
    if (graphChanged) {
      for (const listener of [...graphListeners]) listener(graph, graphChanged);
    }
  }

  /** Applies a command's result, records it for undo, and tells subscribers. */
  function commit<E extends object>(
    label: HistoryLabel,
    edit: GraphEdit<E>,
    coalesce?: Coalesce,
  ): Outcome<E> {
    if (!edit.ok) return edit;
    if (edit.graph === graph) {
      if (edit.selection && !sameSelection(edit.selection, selection)) {
        selection = pruneSelection(graph, edit.selection);
        publish(null);
      }
      return edit;
    }
    const before: Snapshot = { graph, selection };
    graph = edit.graph;
    selection = pruneSelection(graph, edit.selection ?? selection);
    history.record(label, before, { graph, selection }, coalesce);
    publish("edit");
    return edit;
  }

  function select(next: Partial<Selection>) {
    const pruned = pruneSelection(graph, {
      nodeIds: next.nodeIds ?? [],
      edgeIds: next.edgeIds ?? [],
    });
    if (sameSelection(pruned, selection)) return;
    selection = pruned;
    publish(null);
  }

  function restore(entry: Snapshot, source: "undo" | "redo") {
    graph = entry.graph;
    selection = pruneSelection(graph, entry.selection);
    publish(source);
  }

  return {
    catalog,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onGraphChange(listener) {
      graphListeners.add(listener);
      return () => {
        graphListeners.delete(listener);
      };
    },

    addNode: (kind, nodeOptions) =>
      commit("add-node", addNode(graph, catalog, kind, nodeOptions)),
    deleteElements: (ids) => commit("delete", deleteElements(graph, ids ?? {})),
    deleteSelection: () => commit("delete", deleteElements(graph, selection)),
    duplicateNodes: (nodeIds) =>
      commit("duplicate", duplicateNodes(graph, nodeIds ?? selection.nodeIds)),
    moveNodes: (positions, coalesce) =>
      commit("move", moveNodes(graph, positions), coalesce),
    renameNode: (nodeId, name) =>
      commit("rename", renameNode(graph, nodeId, name), {
        key: `rename:${nodeId}`,
        windowMs: 1000,
      }),
    connect: (from, toNode, connectOptions) =>
      commit("connect", connect(graph, from, toNode, connectOptions)),
    disconnect: (edgeId) => commit("disconnect", disconnect(graph, edgeId)),
    setBackEdge: (edgeId, back) =>
      commit("back-edge", setBackEdge(graph, edgeId, back), {
        key: `back:${edgeId}`,
        windowMs: 1000,
      }),
    updateNodeSettings: (nodeId, settings, coalesce) =>
      commit("settings", updateNodeSettings(graph, nodeId, settings), coalesce),
    autoLayout: () => commit("layout", moveNodes(graph, layoutGraph(graph))),

    select,
    selectAll: () =>
      select({
        nodeIds: graph.nodes.map((node) => node.id),
        edgeIds: graph.edges.map((edge) => edge.id),
      }),
    clearSelection: () => select({}),

    undo() {
      const entry = history.undo();
      if (!entry) return false;
      restore(entry, "undo");
      return true;
    },
    redo() {
      const entry = history.redo();
      if (!entry) return false;
      restore(entry, "redo");
      return true;
    },
    sealHistory: () => history.seal(),

    replaceGraph(next, replaceOptions) {
      if (next === graph) return;
      const before: Snapshot = { graph, selection };
      graph = next;
      selection = pruneSelection(graph, selection);
      if (replaceOptions?.keepHistory) {
        history.record("external", before, { graph, selection });
      } else {
        history.clear();
      }
      publish("external");
    },

    validate() {
      if (validation?.graph !== graph) {
        validation = { graph, value: validateEditorGraph(graph, catalog) };
      }
      return validation.value;
    },
    getSelectionContext: () => getSelectionContext(graph, selection),
  };
}
