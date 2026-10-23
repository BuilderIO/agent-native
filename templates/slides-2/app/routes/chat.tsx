import { markAgentChatHomeHandoff } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { AgentChatSurface } from "@agent-native/toolkit/app/chat";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";

import { SlidesComposerContextProvider } from "@/components/editor/SlidesComposerContextProvider";
import { readRouteSlideSelection } from "@/lib/chat-route-selection";
import {
  buildSlidesAgentContext,
  getSlidesAgentScopeLabel,
  haveSameSlidesAgentScope,
  readPublishedSlidesSelection,
  SLIDES_SELECTION_CHANGED_EVENT,
  type SlidesAgentSelection,
} from "@/lib/slide-agent-context";
import { TAB_ID } from "@/lib/tab-id";

const SEO_TITLE = "Slides 2 - Agent chat";
const SEO_DESCRIPTION =
  "Chat with the Slides 2 agent to create, inspect, and refine presentations.";

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
  const routeSlideSelection = readRouteSlideSelection(location.search, deckId);
  const routeSelectionKey = JSON.stringify([deckId, location.search]);
  const syncedRouteSelectionKey = useRef(routeSelectionKey);
  const [slidesSelection, setSlidesSelection] =
    useState<SlidesAgentSelection | null>(
      () => routeSlideSelection ?? readPublishedSlidesSelection(),
    );
  const routeSelectionChanged =
    syncedRouteSelectionKey.current !== routeSelectionKey;
  const activeSlidesSelection = routeSelectionChanged
    ? (routeSlideSelection ?? slidesSelection)
    : slidesSelection;
  useEffect(() => {
    syncedRouteSelectionKey.current = routeSelectionKey;
    const nextRouteSelection = readRouteSlideSelection(location.search, deckId);
    if (!nextRouteSelection) return;
    setSlidesSelection((current) => {
      if (
        current?.deckId === deckId &&
        current.slideId === nextRouteSelection.slideId &&
        current.slideNumber === nextRouteSelection.slideNumber &&
        (current.items?.length ?? 0) === 0
      ) {
        return current;
      }
      return nextRouteSelection;
    });
  }, [deckId, location.search]);
  const scopeLabel = deckId
    ? getSlidesAgentScopeLabel(activeSlidesSelection, deckId)
    : null;
  const scope = deckId
    ? {
        type: "deck" as const,
        id: deckId,
        label:
          scopeLabel?.key === "agent.slideNumber"
            ? t(scopeLabel.key, { number: scopeLabel.number })
            : t(scopeLabel?.key ?? "agent.thisSlide"),
        contextKey: "slides-2-current-context",
        ...buildSlidesAgentContext(activeSlidesSelection, deckId),
      }
    : null;
  const scopeParams = new URLSearchParams();
  if (deckId) {
    scopeParams.set("deckId", deckId);
    if (activeSlidesSelection?.deckId === deckId) {
      if (activeSlidesSelection.slideId?.trim()) {
        scopeParams.set("slideId", activeSlidesSelection.slideId.trim());
      }
      if (
        typeof activeSlidesSelection.slideNumber === "number" &&
        Number.isSafeInteger(activeSlidesSelection.slideNumber) &&
        activeSlidesSelection.slideNumber >= 1
      ) {
        scopeParams.set(
          "slideNumber",
          String(activeSlidesSelection.slideNumber),
        );
      }
    }
  }
  const scopeQuery = scopeParams.size > 0 ? `?${scopeParams.toString()}` : "";
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
      if (detail?.isRunning === true) markAgentChatHomeHandoff("slides-2");
    }

    window.addEventListener("agentNative.chatRunning", handleChatRunning);
    return () =>
      window.removeEventListener("agentNative.chatRunning", handleChatRunning);
  }, []);

  useEffect(() => {
    const onSelectionChanged = (event: Event) => {
      const nextSelection =
        (event as CustomEvent<SlidesAgentSelection | null>).detail ?? null;
      setSlidesSelection((current) =>
        haveSameSlidesAgentScope(current, nextSelection)
          ? current
          : nextSelection,
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
        composerContextProvider={SlidesComposerContextProvider}
        mode="page"
        chatViewTransition
        className="h-full"
        defaultMode="chat"
        scope={scope}
        threadUrlSync={threadUrlSync}
        browserTabId={TAB_ID}
        showHeader={false}
        showTabBar={false}
        showPageHeaderWhenEmpty
        dynamicSuggestions={false}
        suggestions={[
          t("agent.suggestionPitch"),
          t("agent.suggestionBrand"),
          t("agent.suggestionHero"),
        ]}
        suggestionPlacement="after-composer"
        emptyStateText={t("agent.emptyState")}
        emptyStateDisplay="hidden"
        centerComposerWhenEmpty
        composerLayoutVariant="hero"
      />
    </div>
  );
}
