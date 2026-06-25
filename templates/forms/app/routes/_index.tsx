import {
  AgentChatHome,
  appPath,
  markAgentChatHomeHandoff,
  navigateWithAgentChatViewTransition,
  useT,
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
import messages from "@/i18n/en-US";
import { scheduleFormsRoutePrewarm } from "@/lib/route-prewarm";
import { TAB_ID } from "@/lib/tab-id";

const SEO_TITLE = messages.routeTitles.formsIndex;
const SEO_DESCRIPTION = messages.routeDescriptions.formsIndex;

export function meta() {
  return [
    { title: SEO_TITLE },
    {
      name: "description",
      content: SEO_DESCRIPTION,
    },
    { property: "og:title", content: SEO_TITLE },
    { property: "og:description", content: SEO_DESCRIPTION },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: SEO_TITLE },
    { name: "twitter:description", content: SEO_DESCRIPTION },
  ];
}

export default function Index() {
  const navigate = useNavigate();
  const t = useT();

  useEffect(() => {
    function handleChatRunning(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.isRunning === true) markAgentChatHomeHandoff("forms");
    }

    const cancelRoutePrewarm = scheduleFormsRoutePrewarm();
    window.addEventListener("agentNative.chatRunning", handleChatRunning);
    return () => {
      cancelRoutePrewarm();
      window.removeEventListener("agentNative.chatRunning", handleChatRunning);
    };
  }, []);

  function openForms() {
    markAgentChatHomeHandoff("forms");
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
                aria-label={t("home.openDashboard")}
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
                {t("navigation.brand")}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t("home.openDashboard")}
            </TooltipContent>
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
            {t("home.dashboard")}
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
        emptyStateText={t("home.emptyState")}
        emptyStateDisplay="hidden"
        centerComposerWhenEmpty
        composerLayoutVariant="hero"
        composerPlaceholder={t("home.composerPlaceholder")}
        composerSlot={
          <div className="forms-chat-intro">
            <h1>{t("home.heading")}</h1>
            <p>{t("home.description")}</p>
            <div className="forms-chat-pill-row" aria-hidden="true">
              <span>
                <IconDatabase className="size-3.5" />
                {t("home.pillForms")}
              </span>
              <span>
                <IconChartBar className="size-3.5" />
                {t("home.pillAnalytics")}
              </span>
              <span>
                <IconSettings className="size-3.5" />
                {t("home.pillConfiguration")}
              </span>
            </div>
          </div>
        }
      />
    </div>
  );
}
