import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { Header } from "./Header";
import { HeaderActionsProvider } from "./HeaderActions";
import {
  AgentSidebar,
  GuidedQuestionFlow,
  focusAgentChat,
  navigateWithAgentChatViewTransition,
  useAgentChatHomeHandoff,
  useAgentChatHomeHandoffLinks,
  useGuidedQuestionFlow,
} from "@agent-native/core/client";
import { InvitationBanner } from "@agent-native/core/client/org";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { TAB_ID } from "@/lib/tab-id";

interface LayoutProps {
  children: React.ReactNode;
}

const BARE_ROUTES = new Set(["/chart"]);

export function Layout({ children }: LayoutProps) {
  useNavigationState();
  const location = useLocation();
  const navigate = useNavigate();

  // Analytics has two distinct "primary resources" — dashboards
  // (`/dashboards/:id`, legacy `/adhoc/:id`) and ad-hoc analyses
  // (`/analyses/:id`). Each binds the chat to that artifact so a dashboard
  // chat doesn't leak into a different analysis (and vice versa). The list
  // pages and overview leave scope null so general data questions still work.
  const analyticsScope = useMemo(() => {
    const dashMatch = location.pathname.match(
      /^\/(?:adhoc|dashboards)\/([^/]+)/,
    );
    if (dashMatch?.[1]) {
      return { type: "dashboard" as const, id: dashMatch[1] };
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
  // toolbar with NotificationsBell + AgentToggleButton. Skip the framework
  // Header so there's no double-header.
  const isExtensionsRoute =
    location.pathname === "/extensions" ||
    location.pathname.startsWith("/extensions/");
  const isAskRoute = location.pathname === "/ask";
  const chatHomeHandoffActive = useAgentChatHomeHandoff({
    storageKey: "analytics",
    activePath: location.pathname,
    enabled: !isAskRoute,
  });
  useAgentChatHomeHandoffLinks({
    storageKey: "analytics",
    chatPath: "/ask",
  });
  const sidebarScope = chatHomeHandoffActive ? null : analyticsScope;

  function openAskAgentFullscreen() {
    focusAgentChat();
    navigateWithAgentChatViewTransition(navigate, "/ask");
  }

  if (BARE_ROUTES.has(location.pathname)) {
    return <>{children}</>;
  }

  const contentFrame = (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <MobileNav />
      {!isExtensionsRoute && !isAskRoute && <Header />}
      <InvitationBanner />
      <main
        className={
          isExtensionsRoute
            ? "flex-1 overflow-y-auto"
            : isAskRoute
              ? "flex-1 overflow-hidden p-0"
              : "flex-1 overflow-y-auto p-4 md:p-6 lg:p-8"
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
            title={guidedTitle ?? "Clarify the dashboard"}
            description={
              guidedDescription ??
              "A few choices help the agent pick the right source, metrics, cuts, and layout before it writes SQL."
            }
            skipLabel={guidedSkipLabel}
            submitLabel={guidedSubmitLabel}
          />
        </div>
      )}
    </div>
  );

  return (
    <HeaderActionsProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        <div className="hidden shrink-0 md:block">
          <Sidebar />
        </div>
        {isAskRoute ? (
          contentFrame
        ) : (
          <AgentSidebar
            position="right"
            defaultOpen
            chatViewTransition
            storageKey="analytics"
            browserTabId={TAB_ID}
            openOnChatRunning={chatHomeHandoffActive}
            onFullscreenRequest={openAskAgentFullscreen}
            emptyStateText="Ask me to analyze a dashboard, compare trends, or dig into data..."
            suggestions={[
              "What's driving ARR growth this quarter?",
              "Show me churn trends over the last 6 months",
              "Analyze the HubSpot Sales dashboard for anomalies",
              "Compare MRR between enterprise and SMB",
            ]}
            scope={sidebarScope}
          >
            {contentFrame}
          </AgentSidebar>
        )}
      </div>
    </HeaderActionsProvider>
  );
}
