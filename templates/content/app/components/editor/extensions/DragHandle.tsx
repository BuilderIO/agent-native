import { DragHandle as ToolkitDragHandle } from "@agent-native/toolkit/editor";

export const DragHandle = ToolkitDragHandle.configure({
  wrapperSelector: ".visual-editor-wrapper",
});
