import {
  AgentChatSurface,
  useAgentChatContext,
} from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { CreativeContextComposerChip } from "@agent-native/creative-context/client";
import { useEffect, useMemo } from "react";

import { ANALYTICS_CHAT_STORAGE_KEY } from "@/lib/chat-handoff";
import {
  clearSelectedDashboardObjectIfOwned,
  readSelectedDashboardObject,
} from "@/lib/selected-object";
import { TAB_ID } from "@/lib/tab-id";

const DASHBOARD_CONTEXT_KEYS = new Set([
  "analytics-selected-dashboard",
  "analytics-selected-dashboard-panel",
]);

export default function AskPage() {
  const t = useT();
  const { items: chatContextItems, remove: removeChatContextItem } =
    useAgentChatContext();
  const staleDashboardContextKey = useMemo(
    () =>
      chatContextItems.find((item) => DASHBOARD_CONTEXT_KEYS.has(item.key))
        ?.key ?? null,
    [chatContextItems],
  );

  useEffect(() => {
    if (staleDashboardContextKey) {
      removeChatContextItem(staleDashboardContextKey);
    }
  }, [removeChatContextItem, staleDashboardContextKey]);

  useEffect(() => {
    let mounted = true;
    const pathnameAtMount = window.location.pathname;

    void readSelectedDashboardObject().then((selection) => {
      // If the user already navigated away, this Ask instance no longer owns
      // cleanup. The action also CASes the captured selection, covering a
      // selection change that happens after this read but before the write.
      if (!mounted || window.location.pathname !== pathnameAtMount) return;
      if (selection) void clearSelectedDashboardObjectIfOwned(selection);
    });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="analytics-ask-page flex h-full min-h-0 flex-col bg-background">
      <AgentChatSurface
        mode="page"
        chatViewTransition
        className="analytics-chat-panel"
        defaultMode="chat"
        storageKey={ANALYTICS_CHAT_STORAGE_KEY}
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
          <>
            <CreativeContextComposerChip />
            <div className="analytics-chat-intro">
              <h1>{t("common.askIntroTitle")}</h1>
              <p>{t("common.askIntroBody")}</p>
            </div>
          </>
        }
      />
    </div>
  );
}
