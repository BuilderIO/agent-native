import { AgentChatSurface } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";

import { TAB_ID } from "@/lib/tab-id";

export default function ChatRoute() {
  const t = useT();

  return (
    <AgentChatSurface
      mode="page"
      chatViewTransition
      className="h-full"
      defaultMode="chat"
      browserTabId={TAB_ID}
      showHeader
      showTabBar
      dynamicSuggestions={false}
      suggestions={[
        t("agent.ruleSuggestionFilter"),
        t("agent.ruleSuggestionImportant"),
        t("agent.ruleSuggestionArchive"),
      ]}
      emptyStateText={t("agent.emptyState")}
      composerPlaceholder={t("mail.aiFilter.composerPlaceholder")}
    />
  );
}
