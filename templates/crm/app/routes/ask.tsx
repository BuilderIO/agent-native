import {
  AgentChatSurface,
  markAgentChatHomeHandoff,
} from "@agent-native/core/client/agent-chat";
import { useEffect } from "react";

import { TAB_ID } from "@/lib/tab-id";

export function meta() {
  return [{ title: "Ask CRM" }];
}

export default function AskCrmRoute() {
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
    <div className="flex h-full min-h-0 flex-col bg-background">
      <AgentChatSurface
        mode="page"
        chatViewTransition
        className="crm-chat-panel"
        storageKey="crm"
        browserTabId={TAB_ID}
        defaultMode="chat"
        showHeader={false}
        showTabBar={false}
        dynamicSuggestions={false}
        suggestions={[]}
        emptyStateText="Ask CRM"
        emptyStateDisplay="hidden"
        centerComposerWhenEmpty
        composerLayoutVariant="hero"
        composerPlaceholder="Ask about your CRM"
        composerSlot={
          <div className="crm-chat-intro">
            <h1>Ask CRM</h1>
            <p>
              Explore permitted account context, follow-up work, and evidence
              across Native SQL and connected records.
            </p>
          </div>
        }
      />
    </div>
  );
}
