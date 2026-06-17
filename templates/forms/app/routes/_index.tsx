import {
  AgentChatHome,
  appPath,
  startAgentChatViewTransition,
} from "@agent-native/core/client";
import {
  IconArrowRight,
  IconChartBar,
  IconDatabase,
  IconForms,
  IconSettings,
} from "@tabler/icons-react";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { markFormsChatHomeHandoff } from "@/lib/chat-home-handoff";

export function meta() {
  return [
    { title: "Forms - Agent-Native" },
    {
      name: "description",
      content:
        "Your AI agent builds, publishes, and analyzes forms alongside you.",
    },
  ];
}

export default function Index() {
  const navigate = useNavigate();

  useEffect(() => {
    function handleChatRunning(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.isRunning === true) markFormsChatHomeHandoff();
    }

    window.addEventListener("agentNative.chatRunning", handleChatRunning);
    return () =>
      window.removeEventListener("agentNative.chatRunning", handleChatRunning);
  }, []);

  function openForms() {
    markFormsChatHomeHandoff();
    startAgentChatViewTransition(() => navigate("/forms", { flushSync: true }));
  }

  return (
    <div className="forms-home-page relative min-h-screen overflow-hidden bg-background">
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex h-16 items-center justify-between px-4 sm:px-6">
        <div className="pointer-events-auto flex items-center gap-2 text-sm font-semibold">
          <img
            src={appPath("/agent-native-icon-light.svg")}
            alt=""
            aria-hidden="true"
            className="block h-4 w-auto shrink-0 dark:hidden"
          />
          <img
            src={appPath("/agent-native-icon-dark.svg")}
            alt=""
            aria-hidden="true"
            className="hidden h-4 w-auto shrink-0 dark:block"
          />
          Forms
        </div>
        <div className="pointer-events-auto flex items-center gap-1.5">
          <ThemeToggle />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={openForms}
          >
            Dashboard
            <IconArrowRight className="size-3.5" />
          </Button>
        </div>
      </header>
      <AgentChatHome
        className="relative z-10 min-h-screen px-4 py-8 sm:px-6"
        contentClassName="max-w-4xl pb-12 pt-16"
        surfaceClassName="forms-home-chat-panel border-0 bg-transparent shadow-none"
        defaultMode="chat"
        storageKey="forms"
        showHeader={false}
        showTabBar={false}
        dynamicSuggestions={false}
        suggestions={[]}
        emptyStateText="Ask Forms what to build, publish, or analyze."
        emptyStateDisplay="hidden"
        centerComposerWhenEmpty
        composerLayoutVariant="hero"
        composerPlaceholder="Ask about @forms, responses, analytics, or configuration..."
        composerSlot={
          <div className="forms-chat-intro">
            <div className="forms-chat-kicker">
              <IconForms className="size-3.5" />
              Agent-Native Forms
            </div>
            <h1>What do you want to do?</h1>
            <p>
              Build a form, inspect results, chart submissions, or tune a form's
              setup from the same conversation.
            </p>
            <div className="forms-chat-pill-row" aria-hidden="true">
              <span>
                <IconDatabase className="size-3.5" />
                @tag forms
              </span>
              <span>
                <IconChartBar className="size-3.5" />
                analytics
              </span>
              <span>
                <IconSettings className="size-3.5" />
                configuration
              </span>
            </div>
          </div>
        }
      />
    </div>
  );
}
