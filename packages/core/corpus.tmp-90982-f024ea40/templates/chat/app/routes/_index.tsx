import {
  AgentChatSurface,
  markAgentChatHomeHandoff,
  useT,
} from "@agent-native/core/client";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";

import { APP_TITLE } from "@/lib/app-config";
import { TAB_ID } from "@/lib/tab-id";

const SEO_TITLE = `${APP_TITLE} - Open Source AI app starter with actions`;
const SEO_DESCRIPTION =
  "Open Source starter for agent-native apps with durable chat, shared actions, UI state, tools, and a backend your agent can extend.";

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

function chatThreadPath(threadId: string | null) {
  return threadId ? `/chat/${encodeURIComponent(threadId)}` : "/";
}

export default function ChatRoute() {
  const { threadId } = useParams();
  const navigate = useNavigate();
  const t = useT();

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
        threadUrlSync={{
          routeThreadId: threadId ?? null,
          getPath: chatThreadPath,
          navigate,
        }}
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
