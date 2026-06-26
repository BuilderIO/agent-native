import {
  AgentChatHome,
  markAgentChatHomeHandoff,
  useT,
} from "@agent-native/core/client";
import { useEffect } from "react";

import { LocalCodebasePicker } from "@/components/plan/LocalCodebasePicker";
import { schedulePlanRoutePrewarm } from "@/lib/route-prewarm";

export function PlanChatPage() {
  const t = useT();
  useEffect(() => {
    function handleChatRunning(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.isRunning === true) markAgentChatHomeHandoff("plans");
    }

    const cancelRoutePrewarm = schedulePlanRoutePrewarm();
    window.addEventListener("agentNative.chatRunning", handleChatRunning);
    return () => {
      cancelRoutePrewarm();
      window.removeEventListener("agentNative.chatRunning", handleChatRunning);
    };
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
      suggestions={[
        t("chat.suggestionShipped"),
        t("chat.suggestionUi"),
        t("chat.suggestionAuth"),
        t("chat.suggestionApi"),
      ]}
      emptyStateText={t("chat.emptyState")}
      emptyStateDisplay="hidden"
      centerComposerWhenEmpty
      composerLayoutVariant="hero"
      composerAreaClassName="plan-chat-composer-area"
      composerPlaceholder={t("chat.placeholder")}
      composerSlot={
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 text-center">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-normal text-foreground sm:text-4xl">
              {t("chat.heading")}
            </h1>
            <p className="mx-auto max-w-2xl text-sm leading-6 text-muted-foreground">
              {t("chat.description")}
            </p>
          </div>
          <LocalCodebasePicker />
        </div>
      }
    />
  );
}
