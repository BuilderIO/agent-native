import {
  AgentSidebar,
  focusAgentChat,
  navigateWithAgentChatViewTransition,
  useAgentChatHomeHandoff,
  useT,
} from "@agent-native/core/client";
import { InvitationBanner } from "@agent-native/core/client/org";
import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router";

import { TAB_ID } from "@/lib/tab-id";

import { Header } from "./Header";
import { HeaderActionsProvider } from "./HeaderActions";
import { Sidebar } from "./Sidebar";

const BARE_ROUTES = new Set(["/form-preview"]);

// Routes whose page renders its own custom toolbar (with AgentToggleButton).
// Layout still mounts Sidebar + AgentSidebar, but skips its own Header so
// there's no double-header.
const NO_HEADER_PREFIXES = ["/forms/", "/extensions", "/response-insights"];

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();
  const chatHomeHandoffActive = useAgentChatHomeHandoff({
    storageKey: "forms",
    activePath: location.pathname,
  });

  // Bind chat to the currently-open form. The `/forms/:id` URL covers
  // both the builder and the responses sub-page (`/forms/:id/responses`);
  // either way we want both screens of the same form to share a chat.
  const formScope = useMemo(() => {
    const match = location.pathname.match(/^\/forms\/([^/]+)/);
    const formId = match?.[1];
    if (!formId) return null;
    return { type: "form" as const, id: formId };
  }, [location.pathname]);
  const sidebarScope = chatHomeHandoffActive ? null : formScope;

  if (BARE_ROUTES.has(location.pathname)) {
    return <>{children}</>;
  }

  // Editor routes (/forms/:id, /forms/:id/responses) render their own
  // toolbar with AgentToggleButton — skip the global Header to avoid
  // a double-header.
  const showHeader = !NO_HEADER_PREFIXES.some((prefix) =>
    location.pathname.startsWith(prefix),
  );

  function openAskAgentFullscreen() {
    focusAgentChat();
    navigateWithAgentChatViewTransition(navigate, "/");
  }

  return (
    <HeaderActionsProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <AgentSidebar
          position="right"
          defaultOpen
          chatViewTransition
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
          scope={sidebarScope}
        >
          <div className="flex h-full flex-1 flex-col overflow-hidden">
            {showHeader ? <Header /> : null}
            <InvitationBanner />
            <main className="flex-1 overflow-auto">{children}</main>
          </div>
        </AgentSidebar>
      </div>
    </HeaderActionsProvider>
  );
}
