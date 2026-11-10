import { DragHandle as ToolkitDragHandle } from "@agent-native/toolkit/editor";

import { openBlockActionsMenu } from "../BlockActionsMenu";

export const DragHandle = ToolkitDragHandle.configure({
  openMenu: openBlockActionsMenu,
  wrapperSelector: ".visual-editor-wrapper",
});
