import {
  AgentChatSurface,
  markAgentChatHomeHandoff,
} from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";

import { useSlidesComposerContext } from "@/components/editor/SlidesComposerContext";
import { describeComposerContext } from "@/lib/composer-context";
import {
  buildSlidesAgentContext,
  hasCurrentSlideSelection,
  readPublishedSlidesSelection,
} from "@/lib/slide-agent-context";
import { TAB_ID } from "@/lib/tab-id";

const SEO_TITLE = "Slides - Agent chat";
const SEO_DESCRIPTION =
  "Chat with the Slides agent to create, inspect, and refine presentations.";

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
  const deckId = new URLSearchParams(location.search).get("deckId");
  const [contextThreadId, setContextThreadId] = useState("");
  const composerContext = useSlidesComposerContext(
    deckId,
    `chat:${contextThreadId}`,
  );
  const slidesSelection = readPublishedSlidesSelection();
  const scope = deckId
    ? {
        type: "deck" as const,
        id: deckId,
        label: t(
          hasCurrentSlideSelection(slidesSelection, deckId)
            ? "agent.currentSelection"
            : "agent.thisSlide",
        ),
        contextKey: "slides-current-context",
        ...buildSlidesAgentContext(slidesSelection, deckId),
        context: `${buildSlidesAgentContext(slidesSelection, deckId).context}\n${describeComposerContext(composerContext.selection)}`,
      }
    : null;
  const scopeQuery = deckId ? `?deckId=${encodeURIComponent(deckId)}` : "";
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
      if (detail?.isRunning === true) markAgentChatHomeHandoff("slides");
    }

    window.addEventListener("agentNative.chatRunning", handleChatRunning);
    return () =>
      window.removeEventListener("agentNative.chatRunning", handleChatRunning);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {composerContext.dialogs}
      <AgentChatSurface
        mode="page"
        chatViewTransition
        className="h-full"
        defaultMode="chat"
        storageKey="slides"
        scope={scope}
        threadUrlSync={threadUrlSync}
        browserTabId={TAB_ID}
        showHeader={false}
        showTabBar={false}
        dynamicSuggestions={false}
        suggestions={[
          t("agent.suggestionPitch"),
          t("agent.suggestionBrand"),
          t("agent.suggestionHero"),
        ]}
        emptyStateText={t("agent.emptyState")}
        emptyStateDisplay="hidden"
        centerComposerWhenEmpty
        composerLayoutVariant="hero"
        onActiveThreadChange={setContextThreadId}
        composerContextThreadId={deckId ? undefined : contextThreadId}
        composerContextItems={composerContext.props.contextItems}
        composerContextMenuItems={composerContext.props.contextMenuItems}
        onRemoveComposerContextItem={composerContext.props.onRemoveContextItem}
        onInspectComposerContextItem={
          composerContext.props.onInspectContextItem
        }
        onRetryComposerContextItem={composerContext.props.onRetryContextItem}
        onBeforeComposerSubmit={async (items) => {
          await composerContext.beforeSend({ contextItems: items });
          return true;
        }}
      />
    </div>
  );
}
