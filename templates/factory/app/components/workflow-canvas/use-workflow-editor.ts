import { useEffect, useRef, useSyncExternalStore } from "react";

import {
  createWorkflowEditor,
  type ChangeSource,
  type EditorSnapshot,
  type Selection,
  type WorkflowCatalog,
  type WorkflowEditor,
  type WorkflowGraph,
} from "@/lib/workflow-editor";

export interface UseWorkflowEditorOptions {
  /** The saved graph. A new object that is not the editor's own latest edit replaces what is on screen. */
  graph: WorkflowGraph;
  catalog: WorkflowCatalog;
  /** Called with the new graph after every edit, undo and redo. Not called for a `graph` prop swap. */
  onChange?: (graph: WorkflowGraph, source: ChangeSource) => void;
  onSelectionChange?: (selection: Selection) => void;
  initialSelection?: Selection;
}

/**
 * Owns one editor for as long as the component lives and keeps it in step with
 * a controlled `graph`. The page saves from `onChange`; swapping `graph` for
 * something the editor did not produce (an agent edit, a restored version)
 * clears undo history, since its steps describe a graph that is gone.
 */
export function useWorkflowEditor(
  options: UseWorkflowEditorOptions,
): WorkflowEditor {
  const { graph, catalog } = options;
  const onChange = useRef(options.onChange);
  const onSelectionChange = useRef(options.onSelectionChange);
  onChange.current = options.onChange;
  onSelectionChange.current = options.onSelectionChange;

  // A different catalog is a different editor; `graph` swaps go through replaceGraph.
  const created = useRef<{
    catalog: WorkflowCatalog;
    editor: WorkflowEditor;
  } | null>(null);
  if (created.current?.catalog !== catalog) {
    created.current = {
      catalog,
      editor: createWorkflowEditor({
        graph,
        catalog,
        selection: options.initialSelection,
      }),
    };
  }
  const editor = created.current.editor;

  useEffect(() => {
    const current = editor.getSnapshot().graph;
    // The page usually hands back the graph an edit produced; only a different one is a swap.
    if (
      current !== graph &&
      JSON.stringify(current) !== JSON.stringify(graph)
    ) {
      editor.replaceGraph(graph);
    }
  }, [editor, graph]);

  useEffect(
    () =>
      editor.onGraphChange((next, source) => {
        onChange.current?.(next, source);
      }),
    [editor],
  );

  useEffect(() => {
    let last = editor.getSnapshot().selection;
    return editor.subscribe(() => {
      const next = editor.getSnapshot().selection;
      if (next === last) return;
      last = next;
      onSelectionChange.current?.(next);
    });
  }, [editor]);

  return editor;
}

export function useEditorSnapshot(editor: WorkflowEditor): EditorSnapshot {
  return useSyncExternalStore(
    editor.subscribe,
    editor.getSnapshot,
    editor.getSnapshot,
  );
}
