import { useEffect, useState } from "react";

/** Custom event used by top-level hosts such as Electron webviews. */
export const APP_CHAT_SIDEBAR_STATE_EVENT = "agent-native:per-app-chat-state";
/** postMessage sent from a per-app chat host to its embedded app. */
export const APP_CHAT_SIDEBAR_STATE_MESSAGE = "agentNative.perAppChatState";
/** Request sent by an iframe that mounted after the host announced its state. */
export const APP_CHAT_SIDEBAR_STATE_REQUEST_MESSAGE =
  "agentNative.perAppChatStateRequest";

export interface AppChatSidebarState {
  open: boolean;
}

export function buildAppChatSidebarStateMessage(open: boolean): {
  type: typeof APP_CHAT_SIDEBAR_STATE_MESSAGE;
  data: AppChatSidebarState;
} {
  return {
    type: APP_CHAT_SIDEBAR_STATE_MESSAGE,
    data: { open },
  };
}

export function buildAppChatSidebarStateRequest(): {
  type: typeof APP_CHAT_SIDEBAR_STATE_REQUEST_MESSAGE;
} {
  return { type: APP_CHAT_SIDEBAR_STATE_REQUEST_MESSAGE };
}

/**
 * The two host shells are the only AgentSidebar instances that control a
 * separate app surface. Keeping this check here prevents ordinary in-app
 * agent panels from changing the app's navigation chrome.
 */
export function isPerAppChatStorageKey(
  storageKey: string | undefined,
): boolean {
  return (
    storageKey === "desktop-app-chat" || storageKey === "dispatch-app-chat"
  );
}

export function usePerAppChatOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const applyState = (value: unknown) => {
      if (typeof value === "boolean") setOpen(value);
    };
    const handleCustomEvent = (event: Event) => {
      applyState((event as CustomEvent<AppChatSidebarState>).detail?.open);
    };
    const handleMessage = (event: MessageEvent) => {
      if (window.parent === window || event.source !== window.parent) return;
      if (event.data?.type !== APP_CHAT_SIDEBAR_STATE_MESSAGE) return;
      applyState(event.data.data?.open);
    };

    window.addEventListener(APP_CHAT_SIDEBAR_STATE_EVENT, handleCustomEvent);
    window.addEventListener("message", handleMessage);
    if (window.parent !== window) {
      window.parent.postMessage(buildAppChatSidebarStateRequest(), "*");
    }

    return () => {
      window.removeEventListener(
        APP_CHAT_SIDEBAR_STATE_EVENT,
        handleCustomEvent,
      );
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  return open;
}
