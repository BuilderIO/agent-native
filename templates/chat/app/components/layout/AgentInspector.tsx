import {
  AgentSidebar,
  focusAgentChat,
  navigateWithAgentChatViewTransition,
} from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { type ReactNode } from "react";
import { useNavigate } from "react-router";

import { TAB_ID } from "@/lib/tab-id";

interface AgentInspectorProps {
  children: ReactNode;
  chatHomeHandoffActive: boolean;
  chatHomeHandoffPending: boolean;
}

/** Legacy inspector sidebar, loaded only outside the primary AgentKit Chat. */
export function AgentInspector({
  children,
  chatHomeHandoffActive,
  chatHomeHandoffPending,
}: AgentInspectorProps) {
  const navigate = useNavigate();
  const t = useT();

  function openAskAgentFullscreen() {
    focusAgentChat();
    navigateWithAgentChatViewTransition(navigate, "/home");
  }

  return (
    <AgentSidebar
      position="right"
      chatViewTransition
      chatViewTransitionHandoff={chatHomeHandoffPending}
      storageKey="chat"
      browserTabId={TAB_ID}
      openOnChatRunning={chatHomeHandoffActive}
      onFullscreenRequest={openAskAgentFullscreen}
      emptyStateText={t("chat.inspectEmptyState")}
      agentPageHref="/settings/agent"
      suggestions={[
        t("chat.inspectSuggestionCapabilities"),
        t("chat.inspectSuggestionHello"),
        t("chat.inspectSuggestionAction"),
      ]}
    >
      {children}
    </AgentSidebar>
  );
}
