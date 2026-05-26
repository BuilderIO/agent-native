import { AgentChatSurface } from "@agent-native/core/client";

export default function AskRoute() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <AgentChatSurface
        mode="page"
        className="brain-chat-panel"
        defaultMode="chat"
        showHeader={false}
        showTabBar={false}
        dynamicSuggestions={false}
        suggestions={[]}
        emptyStateText="Ask Brain about company memory."
        emptyStateDisplay="hidden"
        centerComposerWhenEmpty
        composerLayoutVariant="hero"
        composerPlaceholder="Ask Brain about company memory..."
      />
    </div>
  );
}
