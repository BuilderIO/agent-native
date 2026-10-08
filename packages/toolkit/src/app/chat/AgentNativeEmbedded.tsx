import {
  useAgentNativeEmbeddedBrowserSession,
  type AgentNativeEmbeddedBrowserSessionOptions,
  type AgentNativeEmbeddedCommandCallback,
  type AgentNativeEmbeddedCommandCallbackInfo,
  type UseAgentNativeEmbeddedBrowserSessionOptions,
} from "@agent-native/core/client/AgentNativeEmbedded";
import type {
  AgentNativeClientActions,
  AgentNativeHostCommandHandlers,
  AgentNativeHostContextGetter,
  AgentNativeHostSession,
  AgentNativeScreenSnapshotOptions,
} from "@agent-native/core/client/host-bridge";
import type { AgentNativeWebMcpClient } from "@agent-native/core/client/webmcp";
import type { ReactNode } from "react";

import { AgentChatSurface, type AgentChatSurfaceProps } from "./AgentPanel.js";
import { AgentSidebar, type AgentSidebarProps } from "./AgentSidebar.js";

export interface AgentNativeEmbeddedProps
  extends
    Omit<AgentSidebarProps, "children">,
    UseAgentNativeEmbeddedBrowserSessionOptions {
  children?: ReactNode;
  surface?: "sidebar" | "panel";
  panel?: AgentChatSurfaceProps;
}

export function AgentNativeEmbedded({
  children,
  surface,
  actions,
  getContext,
  enabled,
  screen,
  commands,
  webmcp,
  session,
  browserSession,
  onNavigate,
  onOpenResource,
  onRefresh,
  onRemount,
  onRequestApproval,
  panel,
  ...sidebarProps
}: AgentNativeEmbeddedProps) {
  useAgentNativeEmbeddedBrowserSession({
    enabled,
    actions,
    getContext,
    screen,
    commands,
    webmcp,
    session,
    browserSession,
    onNavigate,
    onOpenResource,
    onRefresh,
    onRemount,
    onRequestApproval,
  });

  const mode = surface ?? (children ? "sidebar" : "panel");
  const browserTabId =
    sidebarProps.browserTabId ??
    panel?.browserTabId ??
    sessionBrowserTabId(session);

  if (mode === "panel" || !children) {
    return <AgentChatSurface browserTabId={browserTabId} {...panel} />;
  }

  return (
    <AgentSidebar {...sidebarProps} browserTabId={browserTabId}>
      {children}
    </AgentSidebar>
  );
}

function sessionBrowserTabId(
  session: UseAgentNativeEmbeddedBrowserSessionOptions["session"],
): string | undefined {
  if (typeof session === "string") return session;
  return typeof session?.id === "string" ? session.id : undefined;
}

export type {
  AgentNativeEmbeddedBrowserSessionOptions,
  AgentNativeEmbeddedCommandCallback,
  AgentNativeEmbeddedCommandCallbackInfo,
  AgentNativeClientActions,
  AgentNativeHostCommandHandlers,
  AgentNativeHostContextGetter,
  AgentNativeHostSession,
  AgentNativeScreenSnapshotOptions,
  AgentNativeWebMcpClient,
};
