import { AgentChatSurface, useT } from "@agent-native/core/client";
import { useState } from "react";

import {
  ANALYTICS_CHAT_STORAGE_KEY,
  hasRecentAnalyticsChat,
} from "@/lib/chat-handoff";
import { TAB_ID } from "@/lib/tab-id";

export default function AskPage() {
  const t = useT();
  const [restoreActiveThread] = useState(() => hasRecentAnalyticsChat());

  return (
    <div className="analytics-ask-page flex h-full min-h-0 flex-col bg-background">
      <AgentChatSurface
        mode="page"
        chatViewTransition
        className="analytics-chat-panel"
        defaultMode="chat"
        storageKey={ANALYTICS_CHAT_STORAGE_KEY}
        restoreActiveThread={restoreActiveThread}
        browserTabId={TAB_ID}
        showHeader={false}
        showTabBar={false}
        dynamicSuggestions={false}
        suggestions={[]}
        emptyStateText={t("common.askAnalytics")}
        emptyStateDisplay="hidden"
        centerComposerWhenEmpty
        composerLayoutVariant="hero"
        composerPlaceholder={t("common.askPlaceholder")}
        composerSlot={
          <div className="analytics-chat-intro">
            <h1>{t("common.askIntroTitle")}</h1>
            <p>{t("common.askIntroBody")}</p>
          </div>
        }
      />
    </div>
  );
}
