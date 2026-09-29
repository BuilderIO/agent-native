import {
  AgentChatHome,
  markAgentChatHomeHandoff,
  sendToAgentChat,
} from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import {
  AgentSuggestionBar,
  agentSuggestionPrompt,
} from "@agent-native/toolkit/agentkit";
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

  function prefillSuggestion(message: string) {
    sendToAgentChat({ message, submit: false, chatTarget: "local" });
  }

  const suggestions = [
    {
      id: "forms",
      label: t("home.pillForms"),
      prompt: "@forms",
    },
    {
      id: "analytics",
      label: t("home.pillAnalytics"),
      prompt: "analytics",
    },
    {
      id: "configuration",
      label: t("home.pillConfiguration"),
      prompt: "configuration",
    },
  ];

  return (
    <AgentChatHome
      className="h-full min-h-0"
      chatViewTransition
      surfaceClassName="forms-ask-chat-panel bg-background shadow-none"
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
      afterComposerSlot={
        <AgentSuggestionBar
          ariaLabel={t("home.heading")}
          suggestions={suggestions}
          onSelect={(suggestion) =>
            prefillSuggestion(agentSuggestionPrompt(suggestion))
          }
          className="px-0 py-0"
        />
      }
      homeIntroSlot={
        <div className="forms-chat-intro">
          <h1>{t("home.heading")}</h1>
        </div>
      }
    />
  );
}
