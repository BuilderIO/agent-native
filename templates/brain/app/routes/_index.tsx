import {
  AgentChatSurface,
  markAgentChatHomeHandoff,
} from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { useBuilderStatus } from "@agent-native/core/client/settings";
import { useEffect } from "react";

import { shouldEnableBrainProviderStatusChecks } from "@/lib/brain-chat-readiness";
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
  const { status: builderStatus, stale: builderStatusStale } =
    useBuilderStatus();

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
        providerStatusChecksEnabled={shouldEnableBrainProviderStatusChecks(
          builderStatus?.configured === true,
          builderStatusStale,
        )}
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
