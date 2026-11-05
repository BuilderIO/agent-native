import type { Editor } from "@tiptap/core";
import { useSyncExternalStore } from "react";

/**
 * Whether the editor takes edits, redrawing when that changes. A page turns
 * editable once live editing connects, after its blocks first draw, and a
 * block view that read `editor.isEditable` while drawing keeps what it read.
 */
export function useEditorEditable(editor: Editor): boolean {
  return useSyncExternalStore(
    (onChange) => {
      // TipTap reports setEditable as an update.
      editor.on("update", onChange);
      return () => {
        editor.off("update", onChange);
      };
    },
    () => editor.isEditable,
  );
}
