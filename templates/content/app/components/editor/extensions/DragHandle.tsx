import { DragHandle as ToolkitDragHandle } from "@agent-native/toolkit/editor";

/**
 * Content's drag-handle extension.
 *
 * The implementation lives in Toolkit
 * (`packages/toolkit/src/editor/DragHandle.ts`) so other apps
 * (e.g. the plan editor) can reuse the same `::` grip + block-selection +
 * drag-to-reorder affordance. This module is a thin re-export configured with
 * Content's wrapper selector so the behavior stays byte-identical and existing
 * imports (`./extensions/DragHandle`) keep working unchanged.
 */
export const DragHandle = ToolkitDragHandle.configure({
  wrapperSelector: ".visual-editor-wrapper",
});
