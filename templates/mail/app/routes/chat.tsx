import { useT } from "@agent-native/core/client/i18n";
import { AgentChatSurface } from "@agent-native/toolkit/app/chat";
import { useNavigate, useParams } from "react-router";

import { TAB_ID } from "@/lib/tab-id";

// Serves both /chat and /chat/:threadId (chat.$threadId.tsx re-exports this
// module). Keep it the only component rendered for both paths so the chat is
// not remounted when the thread URL changes mid-run.
export default function ChatRoute() {
  const t = useT();
  const { threadId } = useParams();
  const navigate = useNavigate();

  return (
    <AgentChatSurface
      mode="page"
      chatViewTransition
      className="h-full"
      defaultMode="chat"
      threadUrlSync={{
        routeThreadId: threadId ?? null,
        getPath: (id: string | null) =>
          id ? `/chat/${encodeURIComponent(id)}` : "/chat",
        navigate,
      }}
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
