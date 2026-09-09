import { DragHandle as ToolkitDragHandle } from "@agent-native/toolkit/editor";

import { pageTrashMessages } from "@/page-trash-messages";

/**
 * Content's drag-handle extension.
 *
 * The implementation lives in Toolkit
 * (`packages/toolkit/src/editor/DragHandle.ts`) so other apps
 * (e.g. the plan editor) can reuse the same `::` grip + block-selection +
 * drag-to-reorder affordance. This module is a thin re-export configured with
 * Content's wrapper selector and Reference-specific removal label.
 */
export const DragHandle = ToolkitDragHandle.configure({
  wrapperSelector: ".visual-editor-wrapper",
  getDeleteLabel: (node) => {
    if (node.type.name !== "contentReference") return undefined;
    const locale =
      typeof document === "undefined" ? "en-US" : document.documentElement.lang;
    const messages =
      pageTrashMessages[locale as keyof typeof pageTrashMessages] ??
      pageTrashMessages["en-US"];
    return messages.removeReference;
  },
});
