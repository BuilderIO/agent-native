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
          "Call hello for Builder",
          "Add a notes data model and a notes list",
          "Show me what actions are available here",
        ]}
        emptyStateText="Ask the agent to run an action, explain the app, or build the next piece."
        emptyStateDisplay="hidden"
        centerComposerWhenEmpty
        composerLayoutVariant="hero"
        composerPlaceholder="Ask your agent to build, run, or explain something..."
        composerSlot={
          <div className="mx-auto mb-5 max-w-xl px-4 text-center">
            <h1 className="text-2xl font-semibold tracking-normal text-foreground sm:text-3xl">
              What should this agent do?
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Start in chat. Add actions, data models, screens, jobs, or your
              own agent backend when the workflow needs more shape.
            </p>
          </div>
        }
      />
    </div>
  );
}
