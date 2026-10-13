import {
  ACTION_CHAT_UI_AGENT_TEAM_PROGRESS_RENDERER,
  ACTION_CHAT_UI_INLINE_EXTENSION_RENDERER,
  ACTION_CHAT_UI_RECORD_CHANGE_RENDERER,
} from "@agent-native/core/action-ui";
import { cn } from "@agent-native/toolkit/utils";
import type { ReactNode } from "react";

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
  if (
    !context.chatUI ||
    isBuiltinDataWidget ||
    context.chatUI.renderer === ACTION_CHAT_UI_AGENT_TEAM_PROGRESS_RENDERER ||
    context.chatUI.renderer === ACTION_CHAT_UI_RECORD_CHANGE_RENDERER
  ) {
    return <>{children}</>;
  }

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
