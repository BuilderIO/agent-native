import { useT } from "@agent-native/core/client/i18n";
import {
  DrawOverlay as ToolkitDrawOverlay,
  type DrawOverlayProps as ToolkitDrawOverlayProps,
} from "@agent-native/toolkit/canvas-annotations";

export type { DrawAnnotation } from "@agent-native/toolkit/canvas-annotations";

export type DrawOverlayProps = Omit<ToolkitDrawOverlayProps, "translate">;

export function DrawOverlay(props: DrawOverlayProps) {
  const translate = useT();
  return <ToolkitDrawOverlay {...props} translate={translate} />;
}
