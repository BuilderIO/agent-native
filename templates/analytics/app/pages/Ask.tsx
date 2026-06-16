import { AgentChatSurface } from "@agent-native/core/client";

export default function AskPage() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <AgentChatSurface
        mode="page"
        className="analytics-chat-panel"
        defaultMode="chat"
        restoreActiveThread={false}
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
