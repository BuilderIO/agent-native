import {
  AgentChatHome,
  appPath,
  navigateWithAgentChatViewTransition,
} from "@agent-native/core/client";
import {
  IconArrowRight,
  IconChartBar,
  IconDatabase,
  IconSettings,
} from "@tabler/icons-react";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { markFormsChatHomeHandoff } from "@/lib/chat-home-handoff";
import { TAB_ID } from "@/lib/tab-id";

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
    navigateWithAgentChatViewTransition(navigate, "/forms");
  }

  return (
    <div className="forms-home-page relative h-[100dvh] min-h-0 overflow-hidden bg-background">
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex h-16 items-center justify-between px-4 sm:px-6">
        <TooltipProvider delayDuration={700}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Open dashboard"
                className="pointer-events-auto flex items-center gap-2 rounded-md text-sm font-semibold text-foreground transition-colors hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={openForms}
              >
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
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Open dashboard</TooltipContent>
          </Tooltip>
        </TooltipProvider>
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
        className="relative z-10 h-full min-h-0 overflow-hidden px-4 py-0 sm:px-6 sm:py-0"
        contentClassName="h-full min-h-0 max-w-4xl"
        surfaceClassName="forms-home-chat-panel border-0 bg-transparent shadow-none"
        defaultMode="chat"
        storageKey="forms"
        browserTabId={TAB_ID}
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
