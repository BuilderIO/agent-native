import { AgentChatSurface } from "@agent-native/core/client";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [
    { title: APP_TITLE },
    {
      name: "description",
      content:
        "A chat-first agent-native app where actions, UI, state, and your agent backend can grow together.",
    },
  ];
}

export default function ChatRoute() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <AgentChatSurface
        mode="page"
        className="h-full"
        defaultMode="chat"
        restoreActiveThread={false}
        showHeader={false}
        showTabBar={false}
        dynamicSuggestions={false}
        suggestions={[
          "What can you do?",
          "Help me customize this chat app",
          "Show me the actions and pages I can add",
        ]}
        emptyStateText="Ask anything, then customize the app when you need more."
        emptyStateDisplay="hidden"
        centerComposerWhenEmpty
        composerLayoutVariant="hero"
        composerPlaceholder="Message the agent..."
        composerSlot={
          <div className="mx-auto mb-5 max-w-xl px-4 text-center">
            <h1 className="text-2xl font-semibold tracking-normal text-foreground sm:text-3xl">
              How can I help?
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Chat about anything. Add actions, components, pages, jobs, or your
              own agent backend when you want this app to do more.
            </p>
          </div>
        }
      />
    </div>
  );
}
