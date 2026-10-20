// Mounting the editor:
//
//   const editor = useWorkflowEditor({ graph, catalog, onChange: save });
//   <WorkflowCanvas editor={editor} overlay={overlay} />
//   <NodeInspector editor={editor} />
//
// `catalog` is an operation catalog with `get` and `list` (the registry in
// `server/workflow/catalog` has both). Hand `graph` back unchanged in
// `onChange`; a different graph is treated as an outside edit and clears undo.
export { WorkflowCanvas, type WorkflowCanvasProps } from "./WorkflowCanvas";
export type { StepOverlay, WorkflowOverlay } from "./overlay";
export {
  useEditorSnapshot,
  useWorkflowEditor,
  type UseWorkflowEditorOptions,
} from "./use-workflow-editor";
export {
  createWorkflowCanvasStrings,
  useWorkflowCanvasStrings,
  type WorkflowCanvasStrings,
} from "./strings";
export {
  NodeInspector,
  type NodeInspectorProps,
} from "./inspector/NodeInspector";
