import { appPath } from "@agent-native/core/client/api-path";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useEffect, useRef } from "react";

import {
  ANALYTICS_USER_PREFS_KEY,
  type AnalyticsUserPrefs,
} from "../../shared/analytics-user-prefs";

const AGENT_COMPLETION_SOUND_URL = appPath("/agent-completion.mp3");
const DEFAULT_TAB_ID = "__default__";

function getTabId(detail: unknown): string {
  if (
    detail &&
    typeof detail === "object" &&
    "tabId" in detail &&
    typeof detail.tabId === "string" &&
    detail.tabId
  ) {
    return detail.tabId;
  }
  return DEFAULT_TAB_ID;
}

/** Plays the shared Builder bell after a successful Analytics agent run. */
export function AgentCompletionSound() {
  const { data: prefs, isError } = useActionQuery<AnalyticsUserPrefs>(
    "get-user-pref",
    { key: ANALYTICS_USER_PREFS_KEY },
  );
  const soundEnabledRef = useRef(true);
  const runningTabsRef = useRef(new Set<string>());
  const autoContinuingTabsRef = useRef(new Set<string>());
  const failedTabsRef = useRef(new Set<string>());

  useEffect(() => {
    // An unreadable preference must not be treated as a successful read. The
    // absent key is different: it preserves the Builder-internal default-on behavior.
    soundEnabledRef.current =
      !isError && (prefs === undefined || prefs.bellSoundEnabled !== false);
  }, [isError, prefs]);

  useEffect(() => {
    const handleRunError = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      failedTabsRef.current.add(getTabId(detail));
    };

    const handleAutoContinue = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      autoContinuingTabsRef.current.add(getTabId(detail));
    };

    const handleChatRunning = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const tabId = getTabId(detail);

      if (detail?.isRunning === true) {
        autoContinuingTabsRef.current.delete(tabId);
        failedTabsRef.current.delete(tabId);
        runningTabsRef.current.add(tabId);
        return;
      }

      if (
        detail?.isRunning !== false ||
        !runningTabsRef.current.delete(tabId)
      ) {
        return;
      }

      const wasAutoContinued = autoContinuingTabsRef.current.delete(tabId);
      const failed = failedTabsRef.current.delete(tabId);
      if (
        wasAutoContinued ||
        failed ||
        detail.reason === "failed" ||
        detail.reason === "stopped" ||
        !soundEnabledRef.current ||
        typeof Audio === "undefined"
      ) {
        return;
      }

      const audio = new Audio(AGENT_COMPLETION_SOUND_URL);
      audio.volume = 0.5;
      void audio.play().catch(() => {
        // Browsers may reject playback until the user has interacted with the page.
      });
    };

    window.addEventListener("agent-chat:run-error", handleRunError);
    window.addEventListener("agent-chat:auto-continue", handleAutoContinue);
    window.addEventListener("agentNative.chatRunning", handleChatRunning);
    return () => {
      window.removeEventListener("agent-chat:run-error", handleRunError);
      window.removeEventListener(
        "agent-chat:auto-continue",
        handleAutoContinue,
      );
      window.removeEventListener("agentNative.chatRunning", handleChatRunning);
    };
  }, []);

  return null;
}
