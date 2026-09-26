import {
  AgentSidebar,
  focusAgentChat,
  isAgentChatHomeHandoffActive,
  navigateWithAgentChatViewTransition,
  useAgentChatHomeHandoff,
  useAgentChatHomeHandoffLinks,
} from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { InvitationBanner } from "@agent-native/core/client/org";
import { HeaderActionsProvider } from "@agent-native/toolkit/app-shell";
import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router";

import { TAB_ID } from "@/lib/tab-id";

import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

const BARE_ROUTES = new Set(["/form-preview"]);

const NO_HEADER_PREFIXES = ["/forms/", "/extensions", "/response-insights"];

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();
  const isAskRoute = location.pathname === "/ask";
  const chatHomeHandoffActive = useAgentChatHomeHandoff({
    storageKey: "forms",
    activePath: location.pathname,
    enabled: !isAskRoute,
  });
  const chatHomeHandoffPending = isAgentChatHomeHandoffActive("forms");
  useAgentChatHomeHandoffLinks({
    storageKey: "forms",
    chatPath: "/ask",
    requireActiveHandoff: true,
  });

  const formScope = useMemo(() => {
    const match = location.pathname.match(/^\/forms\/([^/]+)/);
    const formId = match?.[1];
    if (!formId) return null;
    return { type: "form" as const, id: formId };
  }, [location.pathname]);
  if (BARE_ROUTES.has(location.pathname)) {
    return <>{children}</>;
  }

  const showHeader =
    !NO_HEADER_PREFIXES.some((prefix) =>
      location.pathname.startsWith(prefix),
    ) && !isAskRoute;

  function openAskAgentFullscreen() {
    focusAgentChat();
    navigateWithAgentChatViewTransition(navigate, "/ask");
  }

  return (
    <HeaderActionsProvider>
      <div className="agent-layout-shell flex h-screen overflow-hidden">
        <div className="agent-layout-left-drawer flex shrink-0">
          <Sidebar />
        </div>
        {isAskRoute ? (
          <div className="agent-layout-main-surface flex min-w-0 flex-1 overflow-hidden">
            <div className="flex h-full flex-1 flex-col overflow-hidden">
              <InvitationBanner />
              <main className="agent-native-app-main flex-1 overflow-hidden">
                {children}
              </main>
            </div>
          </div>
        ) : (
          <AgentSidebar
            position="right"
            agentPageHref="/settings/agent"
            defaultOpen={false}
            chatViewTransition
            chatViewTransitionHandoff={chatHomeHandoffPending}
            storageKey="forms"
            browserTabId={TAB_ID}
            openOnChatRunning={chatHomeHandoffActive}
            onFullscreenRequest={openAskAgentFullscreen}
            emptyStateText={t("agent.emptyState")}
            suggestions={[
              t("agent.suggestionSurvey"),
              t("agent.suggestionSubmissions"),
              t("agent.suggestionExport"),
            ]}
            scope={formScope}
          >
            <div className="flex h-full flex-1 flex-col overflow-hidden">
              {showHeader ? <Header /> : null}
              <InvitationBanner />
              <main className="agent-native-app-main flex-1 overflow-auto">
                {children}
              </main>
            </div>
          </AgentSidebar>
        )}
      </div>
    </HeaderActionsProvider>
  );
}
