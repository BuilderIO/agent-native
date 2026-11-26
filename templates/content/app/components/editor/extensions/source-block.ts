import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { useEffect, useState } from "react";

export function useSettledValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

export function useSourceCursor(
  editor: Editor,
  getPos: () => number | undefined,
): { editable: boolean; editing: boolean; cursorInside: boolean } {
  return useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const { $from, $to } = current.state.selection;
      const pos = getPos();
      const cursorInside =
        typeof pos === "number" &&
        $from.parent.isTextblock &&
        $from.before() === pos &&
        $to.parent === $from.parent;
      return {
        editable: current.isEditable,
        cursorInside,
        editing: current.isEditable && current.isFocused && cursorInside,
      };
    },
  });
}
