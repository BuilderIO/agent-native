import { markAgentChatHomeHandoff } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { AgentChatHome } from "@agent-native/toolkit/app/chat";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";

import { brainAskThreadPath } from "@/lib/brain";
import { TAB_ID } from "@/lib/tab-id";

const SEO_TITLE = "Brain - Open Source company knowledge base for AI agents";
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

// Serves both /home and /home/:threadId (home.$threadId.tsx re-exports this
// module). Keep it the only component rendered for both paths so the chat is
// not remounted when the thread URL changes mid-run.
export default function AskRoute() {
  const t = useT();
  const { threadId } = useParams();
  const navigate = useNavigate();

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
    <AgentChatHome
      className="h-full min-h-0"
      chatViewTransition
      surfaceClassName="brain-chat-panel"
      defaultMode="chat"
      storageKey="brain"
      threadUrlSync={{
        routeThreadId: threadId ?? null,
        getPath: brainAskThreadPath,
        navigate,
      }}
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
      homeIntroSlot={
        <div className="brain-chat-intro">
          <h1>{t("ask.heroTitle")}</h1>
        </div>
      }
    />
  );
}
