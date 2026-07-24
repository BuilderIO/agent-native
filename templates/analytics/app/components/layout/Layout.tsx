import {
  AgentSidebar,
  GuidedQuestionFlow,
  focusAgentChat,
  markAgentChatHomeHandoff,
  navigateWithAgentChatViewTransition,
  useAgentChatHomeHandoff,
  useAgentChatHomeHandoffLinks,
  useGuidedQuestionFlow,
} from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { InvitationBanner } from "@agent-native/core/client/org";
import { CreativeContextComposerChip } from "@agent-native/creative-context/client";
import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router";

import { useNavigationState } from "@/hooks/use-navigation-state";
import {
  ANALYTICS_CHAT_STORAGE_KEY,
  markAnalyticsChatActivity,
} from "@/lib/chat-handoff";
import { isDashboardReportScreenshot } from "@/lib/dashboard-report-capture";
import { TAB_ID } from "@/lib/tab-id";

import { Header } from "./Header";
import { HeaderActionsProvider } from "./HeaderActions";
import { MobileNav } from "./MobileNav";
import { Sidebar } from "./Sidebar";

interface LayoutProps {
  children: React.ReactNode;
}

const BARE_ROUTES = new Set(["/chart"]);

export function Layout({ children }: LayoutProps) {
  const location = useLocation();

  if (isDashboardReportScreenshot(location.search)) {
    return <DashboardReportLayout>{children}</DashboardReportLayout>;
  }

  return <InteractiveLayout>{children}</InteractiveLayout>;
}

function DashboardReportLayout({ children }: LayoutProps) {
  return (
    <HeaderActionsProvider>
      <main className="agent-native-app-main min-h-screen bg-background p-6 text-foreground md:p-8">
        {children}
      </main>
    </HeaderActionsProvider>
  );
}

function InteractiveLayout({ children }: LayoutProps) {
  useNavigationState();
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();

  // Analytics stages the active primary resource as composer context —
  // dashboards (`/dashboards/:id`, legacy `/adhoc/:id`) and ad-hoc analyses
  // (`/analyses/:id`). List pages and Ask leave context null so general data
  // questions still work.
  const analyticsScope = useMemo(() => {
    const dashMatch = location.pathname.match(
      /^\/(?:adhoc|dashboards)\/([^/]+)/,
    );
    if (dashMatch?.[1]) {
      return {
        type: "dashboard" as const,
        id: dashMatch[1],
        contextKey: "analytics-selected-dashboard",
      };
    }
    const analysisMatch = location.pathname.match(/^\/analyses\/([^/]+)/);
    if (analysisMatch?.[1]) {
      return { type: "analysis" as const, id: analysisMatch[1] };
    }
    return null;
  }, [location.pathname]);

  const {
    questions: guidedQuestions,
    title: guidedTitle,
    description: guidedDescription,
    skipLabel: guidedSkipLabel,
    submitLabel: guidedSubmitLabel,
    handleSubmit: handleGuidedSubmit,
    handleSkip: handleGuidedSkip,
  } = useGuidedQuestionFlow({
    submitMessage: "Here are my answers — go ahead.",
    skipMessage: "Skip the questions — decide for me.",
    buildSubmitContext: ({ formattedAnswers }) =>
      [
        "The user answered guided clarification questions for an analytics task.",
        "",
        "Answers:",
        formattedAnswers,
        "",
        "Use these answers to choose the dashboard scope, data source, metrics, breakdowns, and layout. For dashboards, consult the data dictionary before writing SQL and only ask another question if a required source/table/metric is still genuinely ambiguous.",
      ].join("\n"),
    buildSkipContext: () =>
      "The user skipped the guided analytics questions. Proceed with reasonable defaults, consult the data dictionary before writing SQL, and ask again only if a required source/table/metric is still genuinely ambiguous.",
  });
  // Extensions list (`/extensions`) and viewer (`/extensions/:id`) render their own h-12
  // toolbar. Skip the framework
  // Header so there's no double-header.
  const isExtensionsRoute =
    location.pathname === "/extensions" ||
    location.pathname.startsWith("/extensions/");
  const isSessionDetailRoute = /^\/sessions\/[^/]+/.test(location.pathname);
  // Monitoring renders its own header row (section tabs / "Back to monitors"
  // + the relocated agent toggle), so skip the framework Header to avoid a
  // redundant second title bar.
  const isMonitoringRoute =
    location.pathname === "/monitoring" ||
    location.pathname.startsWith("/monitoring/");
  const isAskRoute = location.pathname === "/ask";
  const chatHomeHandoffActive = useAgentChatHomeHandoff({
    storageKey: ANALYTICS_CHAT_STORAGE_KEY,
    activePath: location.pathname,
    enabled: !isAskRoute,
  });
  useAgentChatHomeHandoffLinks({
    storageKey: ANALYTICS_CHAT_STORAGE_KEY,
    chatPath: "/ask",
    enabled: true,
    requireActiveHandoff: true,
  });
  useEffect(() => {
    function handleChatRunning(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (isAskRoute && typeof detail?.isRunning === "boolean") {
        markAnalyticsChatActivity();
        if (detail.isRunning === true) {
          markAgentChatHomeHandoff(ANALYTICS_CHAT_STORAGE_KEY);
        }
      }
    }

    window.addEventListener("agentNative.chatRunning", handleChatRunning);
    return () =>
      window.removeEventListener("agentNative.chatRunning", handleChatRunning);
  }, [isAskRoute]);

  function openAskAgentFullscreen() {
    focusAgentChat();
    navigateWithAgentChatViewTransition(navigate, "/ask");
  }

  if (BARE_ROUTES.has(location.pathname)) {
    return <>{children}</>;
  }

  const contentFrame = (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <MobileNav showNewChat={isAskRoute} />
      {!isExtensionsRoute &&
        !isAskRoute &&
        !isSessionDetailRoute &&
        !isMonitoringRoute && <Header />}
      <InvitationBanner />
      <main
        className={
          isExtensionsRoute
            ? "agent-native-app-main flex-1 overflow-y-auto"
            : isAskRoute
              ? "agent-native-app-main flex-1 overflow-hidden p-0"
              : "agent-native-app-main flex-1 overflow-y-auto p-6 pt-2"
        }
      >
        {children}
      </main>
      {guidedQuestions && (
        <div className="fixed inset-0 z-[260] bg-background">
          <GuidedQuestionFlow
            questions={guidedQuestions}
            onSubmit={handleGuidedSubmit}
            onSkip={handleGuidedSkip}
            title={guidedTitle ?? t("guidedQuestions.title")}
            description={guidedDescription ?? t("guidedQuestions.description")}
            skipLabel={guidedSkipLabel}
            submitLabel={guidedSubmitLabel}
          />
        </div>
      )}
    </div>
  );

  return (
    <HeaderActionsProvider>
      <div className="agent-layout-shell flex h-screen w-full overflow-hidden bg-background text-foreground">
        <div className="agent-layout-left-drawer hidden shrink-0 md:block">
          <Sidebar />
        </div>
        {isAskRoute ? (
          <div className="agent-layout-main-surface flex min-w-0 flex-1 overflow-hidden">
            {contentFrame}
          </div>
        ) : (
          <AgentSidebar
            position="right"
            defaultOpen={false}
            chatViewTransition
            storageKey={ANALYTICS_CHAT_STORAGE_KEY}
            browserTabId={TAB_ID}
            openOnChatRunning={chatHomeHandoffActive}
            onFullscreenRequest={openAskAgentFullscreen}
            emptyStateText={t("chat.emptyState")}
            agentPageHref="/agent"
            suggestions={[
              t("chat.suggestionArrGrowth"),
              t("chat.suggestionChurn"),
              t("chat.suggestionAnomalies"),
              t("chat.suggestionMrr"),
            ]}
            scope={analyticsScope}
            composerSlot={<CreativeContextComposerChip />}
          >
            {contentFrame}
          </AgentSidebar>
        )}
      </div>
    </HeaderActionsProvider>
  );
}
