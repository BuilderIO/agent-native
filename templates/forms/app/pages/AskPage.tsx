import {
  AgentChatSurface,
  markAgentChatHomeHandoff,
  useT,
} from "@agent-native/core/client";
import { IconChartBar, IconDatabase, IconSettings } from "@tabler/icons-react";
import { useEffect } from "react";

import { scheduleFormsRoutePrewarm } from "@/lib/route-prewarm";
import { TAB_ID } from "@/lib/tab-id";

export function AskPage() {
  const t = useT();

  useEffect(() => {
    function handleChatRunning(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.isRunning === true) markAgentChatHomeHandoff("forms");
    }

    const cancelRoutePrewarm = scheduleFormsRoutePrewarm();
    window.addEventListener("agentNative.chatRunning", handleChatRunning);
    return () => {
      cancelRoutePrewarm();
      window.removeEventListener("agentNative.chatRunning", handleChatRunning);
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <AgentChatSurface
        mode="page"
        chatViewTransition
        className="forms-ask-chat-panel bg-background shadow-none"
        defaultMode="chat"
        storageKey="forms"
        browserTabId={TAB_ID}
        showHeader={false}
        showTabBar={false}
        dynamicSuggestions={false}
        suggestions={[]}
        emptyStateText={t("home.emptyState")}
        emptyStateDisplay="hidden"
        centerComposerWhenEmpty
        composerLayoutVariant="hero"
        composerPlaceholder={t("home.composerPlaceholder")}
        composerSlot={
          <div className="forms-chat-intro">
            <h1>{t("home.heading")}</h1>
            <p>{t("home.description")}</p>
            <div className="forms-chat-pill-row" aria-hidden="true">
              <span>
                <IconDatabase className="size-3.5" />
                {t("home.pillForms")}
              </span>
              <span>
                <IconChartBar className="size-3.5" />
                {t("home.pillAnalytics")}
              </span>
              <span>
                <IconSettings className="size-3.5" />
                {t("home.pillConfiguration")}
              </span>
            </div>
          </div>
        }
      />
    </div>
  );
}
