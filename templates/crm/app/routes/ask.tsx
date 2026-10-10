import { markAgentChatHomeHandoff } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { AgentChatHome } from "@agent-native/toolkit/app/chat";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";

import { crmAskThreadPath } from "@/lib/ask-route";
import { TAB_ID } from "@/lib/tab-id";

export function meta() {
  return [{ title: "Ask CRM" }];
}

// Serves both /ask and /ask/:threadId (ask.$threadId.tsx re-exports this
// module). Keep it the only component rendered for both paths so the chat is
// not remounted when the thread URL changes mid-run.
export default function AskCrmRoute() {
  const t = useT();
  const { threadId } = useParams();
  const navigate = useNavigate();
  useEffect(() => {
    const onChatRunning = (event: Event) => {
      if ((event as CustomEvent<{ isRunning?: boolean }>).detail?.isRunning)
        markAgentChatHomeHandoff("crm");
    };
    window.addEventListener("agentNative.chatRunning", onChatRunning);
    return () =>
      window.removeEventListener("agentNative.chatRunning", onChatRunning);
  }, []);
  return (
    <AgentChatHome
      className="h-full min-h-0"
      chatViewTransition
      surfaceClassName="crm-chat-panel"
      storageKey="crm"
      threadUrlSync={{
        routeThreadId: threadId ?? null,
        getPath: crmAskThreadPath,
        navigate,
      }}
      browserTabId={TAB_ID}
      defaultMode="chat"
      showHeader={false}
      showTabBar={false}
      dynamicSuggestions={false}
      suggestions={[]}
      emptyStateText={t("navigation.askCrm")}
      emptyStateDisplay="hidden"
      centerComposerWhenEmpty
      composerLayoutVariant="hero"
      composerPlaceholder={t("chatHome.placeholder")}
      homeIntroSlot={
        <div className="crm-chat-intro">
          <h1>{t("navigation.askCrm")}</h1>
        </div>
      }
    />
  );
}
