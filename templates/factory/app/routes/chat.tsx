import {
  AgentChatSurface,
  markAgentChatHomeHandoff,
} from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";

import { APP_TITLE } from "@/lib/app-config";
import { TAB_ID } from "@/lib/tab-id";

const SEO_TITLE = `${APP_TITLE} - Agent chat`;
const SEO_DESCRIPTION =
  "Chat with the Factory agent to inspect, explain, or change the app.";

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

function chatThreadPath(threadId: string | null) {
  return threadId ? `/chat/${encodeURIComponent(threadId)}` : "/chat";
}

export default function ChatRoute() {
  const { threadId } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const threadUrlSync = threadId
    ? {
        routeThreadId: threadId,
        getPath: chatThreadPath,
        navigate,
      }
    : undefined;

  useEffect(() => {
    function handleChatRunning(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.isRunning === true) markAgentChatHomeHandoff("chat");
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
        storageKey="chat"
        threadUrlSync={threadUrlSync}
        browserTabId={TAB_ID}
        showHeader={false}
        showTabBar={false}
        dynamicSuggestions={false}
        suggestions={[
          t("chat.suggestionCapabilities"),
          t("chat.suggestionCustomize"),
          t("chat.suggestionActions"),
        ]}
        emptyStateText={t("chat.emptyState")}
        emptyStateDisplay="hidden"
        centerComposerWhenEmpty
        composerLayoutVariant="hero"
        composerPlaceholder={t("chat.composerPlaceholder")}
        composerSlot={
          <div className="mx-auto mb-5 max-w-xl px-4 text-center">
            <h1 className="text-2xl font-semibold tracking-normal text-foreground sm:text-3xl">
              {t("chat.heroTitle")}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {t("chat.heroDescription")}
            </p>
          </div>
        }
      />
    </div>
  );
}
