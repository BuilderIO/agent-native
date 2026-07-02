import {
  appBasePath,
  AgentSidebar,
  GuidedQuestionFlow,
  focusAgentChat,
  markAgentChatHomeHandoff,
  navigateWithAgentChatViewTransition,
  useAgentChatHomeHandoff,
  useGuidedQuestionFlow,
  useT,
} from "@agent-native/core/client";
import { InvitationBanner } from "@agent-native/core/client/org";
import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router";

import { useNavigationState } from "@/hooks/use-navigation-state";
import {
  ANALYTICS_CHAT_STORAGE_KEY,
  hasRecentAnalyticsChat,
  markAnalyticsChatActivity,
} from "@/lib/chat-handoff";
import { TAB_ID } from "@/lib/tab-id";

import { Header } from "./Header";
import { HeaderActionsProvider } from "./HeaderActions";
import {
  isAnalyticsSessionsRoute,
  shouldDefaultOpenAnalyticsSidebar,
} from "./layout-route-policy";
import { MobileNav } from "./MobileNav";
import { Sidebar } from "./Sidebar";

interface LayoutProps {
  children: React.ReactNode;
}

const BARE_ROUTES = new Set(["/chart"]);

function stripBasePath(path: string): string {
  const basePath = appBasePath();
  if (!basePath) return path;
  if (path === basePath) return "/";
  if (path.startsWith(`${basePath}/`)) return path.slice(basePath.length);
  if (path.startsWith(`${basePath}?`) || path.startsWith(`${basePath}#`)) {
    return `/${path.slice(basePath.length)}`;
  }
  return path;
}

function pathnameFromLocalPath(path: string): string {
  return path.split(/[?#]/, 1)[0] || "/";
}

function isFrameworkOrApiPath(pathname: string): boolean {
  return (
    pathname === "/_agent-native" ||
    pathname.startsWith("/_agent-native/") ||
    pathname === "/api" ||
    pathname.startsWith("/api/")
  );
}

function isStaticAssetPath(pathname: string): boolean {
  const lastSegment = pathname.split("/").pop() ?? "";
  return /\.[A-Za-z0-9]{1,12}$/.test(lastSegment);
}

function localPathFromAnchor(anchor: HTMLAnchorElement): string | null {
  if (!anchor.href) return null;
  try {
    const url = new URL(anchor.href);
    if (url.origin !== window.location.origin) return null;
    return stripBasePath(`${url.pathname}${url.search}${url.hash}`);
  } catch {
    return null;
  }
}

function shouldHandleAnchorClick(
  event: MouseEvent,
  anchor: HTMLAnchorElement,
): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }
  if (anchor.target && anchor.target !== "_self") return false;
  if (anchor.hasAttribute("download")) return false;
  return true;
}

export function Layout({ children }: LayoutProps) {
  useNavigationState();
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();
  const reportScreenshot =
    new URLSearchParams(location.search).get("reportScreenshot") === "1";

  // Analytics has two distinct "primary resources" — dashboards
  // (`/dashboards/:id`, legacy `/adhoc/:id`) and ad-hoc analyses
  // (`/analyses/:id`). Each binds the chat to that artifact so a dashboard
  // chat doesn't leak into a different analysis (and vice versa). The list
  // pages and Ask leave scope null so general data questions still work.
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
  const isSessionsRoute = isAnalyticsSessionsRoute(location.pathname);
  const isAskRoute = location.pathname === "/ask";
  const chatHomeHandoffActive = useAgentChatHomeHandoff({
    storageKey: ANALYTICS_CHAT_STORAGE_KEY,
    activePath: location.pathname,
    enabled: !isAskRoute && !reportScreenshot,
  });
  const sidebarScope = chatHomeHandoffActive ? null : analyticsScope;

  useEffect(() => {
    function handleChatRunning(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (typeof detail?.isRunning === "boolean") {
        markAnalyticsChatActivity();
      }
    }

    window.addEventListener("agentNative.chatRunning", handleChatRunning);
    return () =>
      window.removeEventListener("agentNative.chatRunning", handleChatRunning);
  }, []);

  useEffect(() => {
    if (!isAskRoute) return;

    function handleClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (!shouldHandleAnchorClick(event, anchor)) return;
      if (anchor.closest(".agent-panel-root")) return;

      const path = localPathFromAnchor(anchor);
      const pathname = path ? pathnameFromLocalPath(path) : "";
      if (
        !path ||
        pathname === "/ask" ||
        isFrameworkOrApiPath(pathname) ||
        isStaticAssetPath(pathname) ||
        !hasRecentAnalyticsChat()
      ) {
        return;
      }

      event.preventDefault();
      markAgentChatHomeHandoff(ANALYTICS_CHAT_STORAGE_KEY);
      navigateWithAgentChatViewTransition(navigate, path);
    }

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [isAskRoute, navigate]);

  function openAskAgentFullscreen() {
    focusAgentChat();
    navigateWithAgentChatViewTransition(navigate, "/ask");
  }

  if (BARE_ROUTES.has(location.pathname)) {
    return <>{children}</>;
  }

  if (reportScreenshot) {
    return (
      <HeaderActionsProvider>
        <main className="agent-native-app-main min-h-screen bg-background p-6 text-foreground md:p-8">
          {children}
        </main>
      </HeaderActionsProvider>
    );
  }

  const contentFrame = (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <MobileNav />
      {!isExtensionsRoute && !isAskRoute && <Header />}
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
            defaultOpen={
              chatHomeHandoffActive &&
              shouldDefaultOpenAnalyticsSidebar(location.pathname)
            }
            chatViewTransition
            storageKey={ANALYTICS_CHAT_STORAGE_KEY}
            browserTabId={TAB_ID}
            openOnChatRunning={chatHomeHandoffActive && !isSessionsRoute}
            onFullscreenRequest={openAskAgentFullscreen}
            emptyStateText={t("chat.emptyState")}
            suggestions={[
              t("chat.suggestionArrGrowth"),
              t("chat.suggestionChurn"),
              t("chat.suggestionAnomalies"),
              t("chat.suggestionMrr"),
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
