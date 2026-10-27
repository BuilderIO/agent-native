import {
  AGENT_CHAT_RUNNING_EVENT,
  useAgentChatRunningThreads,
} from "@agent-native/core/client/agent-chat";
import { SIDEBAR_STATE_CHANGE_EVENT } from "@agent-native/core/client/agent-sidebar-state";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useRef, useState } from "react";

import {
  isChatThreadViewed,
  subscribeChatThreadViews,
} from "../../agentkit/react/viewed-threads.js";
import {
  markChatThreadRead,
  markChatThreadUnread,
  useChatUnreadThreads,
} from "./chat-unread-state.js";
import {
  createDocumentStatusController,
  createStatusFaviconRenderer,
  type DocumentStatusController,
  type StatusFaviconRenderer,
} from "./document-status.js";
import {
  INITIAL_TAB_RUN_STATE,
  applyAgentRunSignal,
  markTabVisible,
  parseAgentRunSignal,
  tabRunStatus,
  type TabRunState,
} from "./tab-run-status.js";

/** The agent sidebar slides for up to this long after it opens or closes. */
const SIDEBAR_SETTLE_MS = 400;
/** Running state is event-driven; this only catches runs whose end was missed. */
const RUN_VERIFY_INTERVAL_MS = 5_000;

export interface AgentRunAwarenessProps {
  /**
   * Keep unread chats in the user's `application_state`. Off where there is no
   * signed-in user to own the row; the title and favicon still update.
   */
  persistUnread?: boolean | undefined;
  /** Overrides the canvas favicon renderer; `null` leaves the favicon alone. */
  renderFavicon?: StatusFaviconRenderer | null;
}

/**
 * Background awareness for agent runs in this browser tab: the document title
 * and favicon show a run in progress or a reply that finished while the tab
 * was hidden, and a chat whose reply finished while the user was not viewing
 * it is marked unread until it is opened.
 */
export function AgentRunAwareness({
  persistUnread = true,
  renderFavicon,
}: AgentRunAwarenessProps) {
  const t = useT();
  const { runningThreadIds } = useAgentChatRunningThreads({
    pollIntervalMs: RUN_VERIFY_INTERVAL_MS,
  });
  // Reads only what a mounted chat list (or this tab's own writes) already
  // loaded, so app boot does not pay for a request no surface shows.
  const unread = useChatUnreadThreads({ enabled: false });
  const [tabState, setTabState] = useState<TabRunState>(INITIAL_TAB_RUN_STATE);
  const controllerRef = useRef<DocumentStatusController | null>(null);
  const tRef = useRef(t);
  tRef.current = t;
  const rendererRef = useRef(renderFavicon);
  rendererRef.current = renderFavicon;

  useEffect(() => {
    const renderer = rendererRef.current;
    const controller = createDocumentStatusController({
      labels: {
        running: (title) =>
          tRef.current("agentChat.documentTitle.running", { title }),
        replyReady: (title) =>
          tRef.current("agentChat.documentTitle.replyReady", { title }),
      },
      renderFavicon:
        renderer === undefined ? createStatusFaviconRenderer() : renderer,
    });
    controllerRef.current = controller;
    return () => {
      controllerRef.current = null;
      controller.dispose();
    };
  }, []);

  useEffect(() => {
    controllerRef.current?.refresh();
  }, [t]);

  useEffect(() => {
    controllerRef.current?.setStatus(
      tabRunStatus(tabState, runningThreadIds.size),
    );
  }, [tabState, runningThreadIds]);

  useEffect(() => {
    let state = INITIAL_TAB_RUN_STATE;
    const commit = (next: TabRunState) => {
      if (next === state) return;
      state = next;
      setTabState(next);
    };
    const onRunning = (event: Event) => {
      const signal = parseAgentRunSignal((event as CustomEvent).detail);
      if (!signal) return;
      const transition = applyAgentRunSignal(state, signal, {
        hidden: document.visibilityState === "hidden",
      });
      commit(transition.state);
      const threadId = transition.finishedThreadId;
      if (!threadId || !persistUnread || isChatThreadViewed(threadId)) return;
      markChatThreadUnread(threadId).catch((error) => {
        console.error(
          `[agent-native] Could not mark chat ${threadId} unread`,
          error,
        );
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") commit(markTabVisible(state));
    };
    window.addEventListener(AGENT_CHAT_RUNNING_EVENT, onRunning);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener(AGENT_CHAT_RUNNING_EVENT, onRunning);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [persistUnread]);

  const unreadIds =
    unread.status === "ready" ? [...unread.unreadThreadIds].sort() : [];
  const unreadKey = unreadIds.join("\n");

  useEffect(() => {
    if (!persistUnread || !unreadKey) return;
    const ids = unreadKey.split("\n");
    const clearing = new Set<string>();
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const clearViewed = () => {
      for (const threadId of ids) {
        if (clearing.has(threadId) || !isChatThreadViewed(threadId)) continue;
        clearing.add(threadId);
        markChatThreadRead(threadId)
          .catch((error) => {
            console.error(
              `[agent-native] Could not mark chat ${threadId} read`,
              error,
            );
          })
          .finally(() => clearing.delete(threadId));
      }
    };
    const clearAfterSidebarSettles = () => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(clearViewed, SIDEBAR_SETTLE_MS);
    };
    clearViewed();
    const unsubscribe = subscribeChatThreadViews(clearViewed);
    document.addEventListener("visibilitychange", clearViewed);
    window.addEventListener("focus", clearViewed);
    window.addEventListener("pointerdown", clearViewed, true);
    window.addEventListener(
      SIDEBAR_STATE_CHANGE_EVENT,
      clearAfterSidebarSettles,
    );
    return () => {
      clearTimeout(settleTimer);
      unsubscribe();
      document.removeEventListener("visibilitychange", clearViewed);
      window.removeEventListener("focus", clearViewed);
      window.removeEventListener("pointerdown", clearViewed, true);
      window.removeEventListener(
        SIDEBAR_STATE_CHANGE_EVENT,
        clearAfterSidebarSettles,
      );
    };
  }, [persistUnread, unreadKey]);

  return null;
}
