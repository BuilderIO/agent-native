import { DragHandle as CoreDragHandle } from "@agent-native/core/client";

/**
 * Content's drag-handle extension.
 *
 * The implementation now lives in the shared core
 * (`packages/core/src/client/rich-markdown-editor/DragHandle.ts`) so other apps
 * (e.g. the plan editor) can reuse the same `::` grip + block-selection +
 * drag-to-reorder affordance. This module is a thin re-export configured with
 * Content's wrapper selector so the behavior stays byte-identical and existing
 * imports (`./extensions/DragHandle`) keep working unchanged.
 */
export const DragHandle = CoreDragHandle.configure({
  wrapperSelector: ".visual-editor-wrapper",
});
