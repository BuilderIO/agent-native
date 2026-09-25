import type { ReactNode } from "react";

import { ACTION_CHAT_UI_INLINE_EXTENSION_RENDERER } from "../../action-ui.js";
import { cn } from "../utils.js";
import type { ToolRendererContext } from "./tool-render-registry.js";

export function ActionChatUiSurface({
  context,
  isBuiltinDataWidget,
  children,
}: {
  context: ToolRendererContext;
  isBuiltinDataWidget: boolean;
  children: ReactNode;
}) {
  if (!context.chatUI || isBuiltinDataWidget) return <>{children}</>;

  const containsPaddedIframe =
    context.chatUI.renderer === ACTION_CHAT_UI_INLINE_EXTENSION_RENDERER;

  return (
    <div
      data-agent-native-custom-ui=""
      className={cn(
        "my-3 overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-sm empty:hidden",
        !containsPaddedIframe && "p-3",
      )}
    >
      {children}
    </div>
  );
}
