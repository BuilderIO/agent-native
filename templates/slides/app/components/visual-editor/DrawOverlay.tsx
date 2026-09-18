import { useT } from "@agent-native/core/client/i18n";
import {
  DrawOverlay as ToolkitDrawOverlay,
  type DrawOverlayProps as ToolkitDrawOverlayProps,
} from "@agent-native/toolkit/canvas-annotations";

export type { DrawAnnotation } from "@agent-native/toolkit/canvas-annotations";

export type DrawOverlayProps = Omit<ToolkitDrawOverlayProps, "translate">;

export function DrawOverlay(props: DrawOverlayProps) {
  const t = useT();
  const keyMap: Record<string, string> = {
    "visualEditor.typeAnnotationFancy": "raw.typeAnnotation",
    "visualEditor.typeAnywhereOnCanvas": "raw.typeAnywhere",
    "visualEditor.clearAll": "raw.drawClearAll",
    "visualEditor.exitDrawMode": "raw.drawExitMode",
    "visualEditor.undoStroke": "raw.undoStroke",
    "visualEditor.redoStroke": "raw.redoStroke",
    "visualEditor.tellAgentWhatToDo": "raw.tellAgentDo",
    "visualEditor.send": "raw.sendToAgent",
    "visualEditor.sendingDrawing": "raw.sendToAgent",
  };
  const translate: ToolkitDrawOverlayProps["translate"] = (key, options) =>
    t(keyMap[key] ?? key, options);
  return <ToolkitDrawOverlay {...props} translate={translate} />;
}
