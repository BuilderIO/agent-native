import {
  AgentChatSurface,
  markAgentChatHomeHandoff,
} from "@agent-native/core/client/agent-chat";
import { getBrowserTabId } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router";

import { DESIGN_CHAT_STORAGE_KEY } from "@/lib/agent-chat";

const SEO_TITLE = "Design - Agent chat";
const SEO_DESCRIPTION =
  "Chat with the Design agent to create, inspect, and refine prototypes.";

export function meta() {
  return [
    { title: SEO_TITLE },
    { name: "description", content: SEO_DESCRIPTION },
    { property: "og:title", content: SEO_TITLE },
    { property: "og:description", content: SEO_DESCRIPTION },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: SEO_TITLE },
    { name: "twitter:description", content: SEO_DESCRIPTION },
  ];
}

export default function ChatRoute() {
  const { threadId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();
  const designId = new URLSearchParams(location.search).get("designId");
  const scope = designId ? { type: "design" as const, id: designId } : null;
  const scopeQuery = designId
    ? `?designId=${encodeURIComponent(designId)}`
    : "";
  const threadUrlSync = {
    routeThreadId: threadId ?? null,
    getPath: (id: string | null) =>
      id
        ? `/chat/${encodeURIComponent(id)}${scopeQuery}`
        : `/chat${scopeQuery}`,
    navigate,
  };

  useEffect(() => {
    function handleChatRunning(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.isRunning === true)
        markAgentChatHomeHandoff(DESIGN_CHAT_STORAGE_KEY);
    }

    window.addEventListener("agentNative.chatRunning", handleChatRunning);
    return () =>
      window.removeEventListener("agentNative.chatRunning", handleChatRunning);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <AgentChatSurface
        mode="page"
        chatViewTransition
        className="h-full"
        defaultMode="chat"
        storageKey={DESIGN_CHAT_STORAGE_KEY}
        scope={scope}
        threadUrlSync={threadUrlSync}
        browserTabId={getBrowserTabId()}
        showHeader={false}
        showTabBar={false}
        dynamicSuggestions={false}
        suggestions={[
          t("chat.suggestionLandingPage"),
          t("chat.suggestionBrandMatch"),
          t("chat.suggestionMobile"),
        ]}
        emptyStateText={t("chat.emptyState")}
        emptyStateDisplay="hidden"
        centerComposerWhenEmpty
        composerLayoutVariant="hero"
      />
    </div>
  );
}
