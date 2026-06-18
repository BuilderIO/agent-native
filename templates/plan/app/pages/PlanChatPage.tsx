import { useEffect } from "react";
import { AgentChatHome } from "@agent-native/core/client";
import { markPlanChatHomeHandoff } from "@/lib/chat-home-handoff";

const PLAN_CHAT_SUGGESTIONS = [
  "What shipped in the last week?",
  "What does the new checkout UI look like?",
  "When did the auth API change?",
  "What is the shape of the billing API?",
];

export function PlanChatPage() {
  useEffect(() => {
    function handleChatRunning(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.isRunning === true) markPlanChatHomeHandoff();
    }

    window.addEventListener("agentNative.chatRunning", handleChatRunning);
    return () =>
      window.removeEventListener("agentNative.chatRunning", handleChatRunning);
  }, []);

  return (
    <AgentChatHome
      className="h-full min-h-0 bg-background px-4 py-4"
      contentClassName="max-w-5xl"
      surfaceClassName="border-0 bg-transparent shadow-none"
      storageKey="plans"
      restoreActiveThread={false}
      showHeader={false}
      showTabBar={false}
      dynamicSuggestions={false}
      suggestions={PLAN_CHAT_SUGGESTIONS}
      emptyStateText="Ask Plan"
      emptyStateDisplay="hidden"
      centerComposerWhenEmpty
      composerLayoutVariant="hero"
      composerAreaClassName="plan-chat-composer-area"
      composerPlaceholder="Ask what shipped, what changed, or what the current code shows..."
      composerSlot={
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 text-center">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-normal text-foreground sm:text-4xl">
              Ask Plan
            </h1>
            <p className="mx-auto max-w-2xl text-sm leading-6 text-muted-foreground">
              Search merged PR recaps, inspect visual blocks, and publish code
              answers as diagrams, wireframes, API specs, and data models.
            </p>
          </div>
        </div>
      }
    />
  );
}
