import { AgentChatSurface } from "@agent-native/core/client";

export default function AskRoute() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <AgentChatSurface
        mode="page"
        className="brain-chat-panel"
        defaultMode="chat"
        restoreActiveThread={false}
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
