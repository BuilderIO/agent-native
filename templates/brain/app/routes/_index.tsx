import {
  AgentChatSurface,
  markAgentChatHomeHandoff,
  useT,
} from "@agent-native/core/client";
import { useEffect } from "react";

import { TAB_ID } from "@/lib/tab-id";

const SEO_TITLE =
  "Agent-Native Brain - Open Source company knowledge base for AI agents";
const SEO_DESCRIPTION =
  "Open Source company knowledge base that turns Slack, meetings, transcripts, docs, and decisions into cited answers for AI agents.";

export function meta() {
  return [
    { title: SEO_TITLE },
    { name: "description", content: SEO_DESCRIPTION },
    { property: "og:title", content: SEO_TITLE },
    { property: "og:description", content: SEO_DESCRIPTION },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: SEO_TITLE },
    { name: "twitter:description", content: SEO_DESCRIPTION },
  ];
}

export default function AskRoute() {
  const t = useT();

  useEffect(() => {
    function handleChatRunning(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.isRunning === true) markAgentChatHomeHandoff("brain");
    }

    window.addEventListener("agentNative.chatRunning", handleChatRunning);
    return () =>
      window.removeEventListener("agentNative.chatRunning", handleChatRunning);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <AgentChatSurface
        mode="page"
        chatViewTransition
        className="brain-chat-panel"
        defaultMode="chat"
        storageKey="brain"
        browserTabId={TAB_ID}
        showHeader={false}
        showTabBar={false}
        dynamicSuggestions={false}
        suggestions={[]}
        emptyStateText={t("ask.emptyState")}
        emptyStateDisplay="hidden"
        centerComposerWhenEmpty
        composerLayoutVariant="hero"
        composerPlaceholder={t("ask.composerPlaceholder")}
        composerSlot={
          <div className="brain-chat-intro">
            <h1>{t("ask.heroTitle")}</h1>
            <p>{t("ask.heroDescription")}</p>
          </div>
        }
      />
    </div>
  );
}
