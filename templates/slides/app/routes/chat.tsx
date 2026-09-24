import {
  AgentChatSurface,
  markAgentChatHomeHandoff,
} from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";

import {
  buildSlidesAgentContext,
  getSlidesAgentScopeLabel,
  readPublishedSlidesSelection,
  SLIDES_SELECTION_CHANGED_EVENT,
  type SlidesAgentSelection,
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
  const [slidesSelection, setSlidesSelection] =
    useState<SlidesAgentSelection | null>(() => readPublishedSlidesSelection());
  const scopeLabel = deckId
    ? getSlidesAgentScopeLabel(slidesSelection, deckId)
    : null;
  const scope = deckId
    ? {
        type: "deck" as const,
        id: deckId,
        label:
          scopeLabel?.key === "agent.slideNumber"
            ? t(scopeLabel.key, { number: scopeLabel.number })
            : t(scopeLabel?.key ?? "agent.thisSlide"),
        contextKey: "slides-current-context",
        ...buildSlidesAgentContext(slidesSelection, deckId),
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

  useEffect(() => {
    const onSelectionChanged = (event: Event) => {
      setSlidesSelection(
        (event as CustomEvent<SlidesAgentSelection | null>).detail ?? null,
      );
    };
    window.addEventListener(SLIDES_SELECTION_CHANGED_EVENT, onSelectionChanged);
    return () =>
      window.removeEventListener(
        SLIDES_SELECTION_CHANGED_EVENT,
        onSelectionChanged,
      );
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
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
      />
    </div>
  );
}
