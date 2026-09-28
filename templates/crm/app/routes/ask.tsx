import {
  AgentChatHome,
  markAgentChatHomeHandoff,
} from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect } from "react";

import { TAB_ID } from "@/lib/tab-id";

export function meta() {
  return [{ title: "Ask CRM" }];
}

export default function AskCrmRoute() {
  const t = useT();
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
          <p>{t("chatHome.description")}</p>
        </div>
      }
    />
  );
}
