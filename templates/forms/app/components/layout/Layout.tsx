import { useMemo, useState } from "react";
import { useLocation } from "react-router";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { HeaderActionsProvider } from "./HeaderActions";
import { AgentSidebar } from "@agent-native/core/client";
import { InvitationBanner } from "@agent-native/core/client/org";
import { consumeFormsChatHomeHandoff } from "@/lib/chat-home-handoff";

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
  const [chatHomeHandoffPath] = useState(() =>
    consumeFormsChatHomeHandoff() ? location.pathname : null,
  );
  const chatHomeHandoffActive = chatHomeHandoffPath === location.pathname;

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

  return (
    <HeaderActionsProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <AgentSidebar
          position="right"
          defaultOpen
          chatViewTransition
          storageKey="forms"
          openOnChatRunning={chatHomeHandoffActive}
          emptyStateText="Ask me anything about your forms"
          suggestions={[
            "Build a customer feedback survey",
            "Show submissions by day",
            "Export responses to CSV",
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
