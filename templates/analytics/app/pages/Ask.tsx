import { useEffect } from "react";
import {
  AgentChatSurface,
  markAgentChatHomeHandoff,
} from "@agent-native/core/client";
import { TAB_ID } from "@/lib/tab-id";

export default function AskPage() {
  useEffect(() => {
    function handleChatRunning(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.isRunning === true) markAgentChatHomeHandoff("analytics");
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
        className="analytics-chat-panel"
        defaultMode="chat"
        storageKey="analytics"
        restoreActiveThread={false}
        browserTabId={TAB_ID}
        showHeader={false}
        showTabBar={false}
        dynamicSuggestions={false}
        suggestions={[]}
        emptyStateText="Ask Analytics about your data."
        emptyStateDisplay="hidden"
        centerComposerWhenEmpty
        composerLayoutVariant="hero"
        composerPlaceholder="Ask about data, dashboards, metrics, or sources..."
        composerSlot={
          <div className="analytics-chat-intro">
            <h1>What would you like to explore?</h1>
            <p>Ask about data, dashboards, metrics, or sources.</p>
          </div>
        }
      />
    </div>
  );
}
