import {
  AgentChatSurface,
  markAgentChatHomeHandoff,
  sendToAgentChat,
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

  function prefillSuggestion(message: string) {
    sendToAgentChat({ message, submit: false, chatTarget: "local" });
  }

  const suggestions = [
    {
      label: t("home.pillForms"),
      prompt: "@forms",
      icon: IconDatabase,
    },
    {
      label: t("home.pillAnalytics"),
      prompt: "analytics",
      icon: IconChartBar,
    },
    {
      label: t("home.pillConfiguration"),
      prompt: "configuration",
      icon: IconSettings,
    },
  ];

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
            <div className="forms-chat-pill-row">
              {suggestions.map(({ icon: Icon, label, prompt }) => (
                <button
                  key={prompt}
                  type="button"
                  className="forms-chat-pill"
                  onClick={() => prefillSuggestion(prompt)}
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        }
      />
    </div>
  );
}
