import {
  AgentChatSurface,
  markAgentChatHomeHandoff,
} from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { OnboardingPanel } from "@agent-native/core/client/onboarding";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";

import { APP_TITLE } from "@/lib/app-config";
import {
  CHAT_HANDOFF_REFRESH_INTERVAL_MS,
  clearChatHandoff,
} from "@/lib/chat-handoff";
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
  const threadUrlSync = threadId
    ? {
        routeThreadId: threadId,
        getPath: chatThreadPath,
        navigate,
      }
    : undefined;

  useEffect(() => {
    let handoffRefreshTimer: number | null = null;

    function stopHandoffRefresh() {
      if (handoffRefreshTimer === null) return;
      window.clearInterval(handoffRefreshTimer);
      handoffRefreshTimer = null;
    }

    function markChatActivity() {
      markAgentChatHomeHandoff("chat");
      if (handoffRefreshTimer !== null) return;
      handoffRefreshTimer = window.setInterval(
        () => markAgentChatHomeHandoff("chat"),
        CHAT_HANDOFF_REFRESH_INTERVAL_MS,
      );
    }

    // MultiTabAssistantChat only writes a thread URL after its first message,
    // so a /chat/:threadId route is a durable non-empty-chat signal even if
    // the run event happened before this route's effect subscribed.
    if (threadId) markChatActivity();

    function handleChatRunning(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.isRunning === true) {
        markChatActivity();
      } else if (!threadId) {
        stopHandoffRefresh();
      }
    }

    function handleOpenThread(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.newThread !== true) return;
      stopHandoffRefresh();
      clearChatHandoff();
    }

    window.addEventListener("agentNative.chatRunning", handleChatRunning);
    window.addEventListener("agent-chat:open-thread", handleOpenThread);
    return () => {
      stopHandoffRefresh();
      window.removeEventListener("agentNative.chatRunning", handleChatRunning);
      window.removeEventListener("agent-chat:open-thread", handleOpenThread);
    };
  }, [threadId]);

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
          <div className="mx-auto mb-5 flex max-w-xl flex-col gap-4 px-4 text-center">
            <OnboardingPanel className="text-start" />
            <div>
              <h1 className="text-2xl font-semibold tracking-normal text-foreground sm:text-3xl">
                {t("chat.heroTitle")}
              </h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {t("chat.heroDescription")}
              </p>
            </div>
          </div>
        }
      />
    </div>
  );
}
