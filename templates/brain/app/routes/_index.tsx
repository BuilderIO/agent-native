import { useEffect } from "react";
import {
  AgentChatSurface,
  markAgentChatHomeHandoff,
} from "@agent-native/core/client";
import { TAB_ID } from "@/lib/tab-id";

export default function AskRoute() {
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
        emptyStateText="Ask Brain about company knowledge."
        emptyStateDisplay="hidden"
        centerComposerWhenEmpty
        composerLayoutVariant="hero"
        composerPlaceholder="Ask about company knowledge..."
        composerSlot={
          <div className="brain-chat-intro">
            <h1>What do you want to know?</h1>
            <p>Brain answers from cited company knowledge.</p>
          </div>
        }
      />
    </div>
  );
}
