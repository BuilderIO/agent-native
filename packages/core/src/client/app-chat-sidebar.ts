import { useEffect, useState } from "react";

import { getFramePostMessageTargetOrigin } from "./frame.js";

/** Custom event used by top-level hosts such as Electron webviews. */
export const APP_CHAT_SIDEBAR_STATE_EVENT = "agent-native:per-app-chat-state";
/** postMessage sent from a per-app chat host to its embedded app. */
export const APP_CHAT_SIDEBAR_STATE_MESSAGE = "agentNative.perAppChatState";
/** Request sent by an iframe that mounted after the host announced its state. */
export const APP_CHAT_SIDEBAR_STATE_REQUEST_MESSAGE =
  "agentNative.perAppChatStateRequest";

export type AppChatSidebarCommand = "toggle" | "open" | "close";

interface AppChatDesktopBridge {
  chat?: Partial<Record<AppChatSidebarCommand, () => void>>;
}

export interface AppChatSidebarState {
  open: boolean;
  /** True when a parent shell owns chat for this app surface. */
  hosted: boolean;
}

export function buildAppChatSidebarStateMessage(open: boolean): {
  type: typeof APP_CHAT_SIDEBAR_STATE_MESSAGE;
  data: AppChatSidebarState;
} {
  return {
    type: APP_CHAT_SIDEBAR_STATE_MESSAGE,
    data: { open, hosted: true },
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

function readDesktopChatBridge(): AppChatDesktopBridge["chat"] | null {
  if (typeof window === "undefined") return null;
  const bridge = (
    window as Window & { agentNativeDesktop?: AppChatDesktopBridge }
  ).agentNativeDesktop;
  return bridge?.chat ?? null;
}

function readInitialPerAppChatState(): AppChatSidebarState {
  return {
    open: false,
    hosted: readDesktopChatBridge() !== null,
  };
}

export function requestPerAppChatCommand(
  command: AppChatSidebarCommand,
): boolean {
  if (typeof window === "undefined") return false;

  const desktopCommand = readDesktopChatBridge()?.[command];
  if (desktopCommand) {
    desktopCommand();
    return true;
  }

  if (window.parent === window) return false;

  const data = command === "toggle" ? undefined : { open: command === "open" };
  window.parent.postMessage(
    {
      type: "agentNative.toggleSidebar",
      ...(data ? { data } : {}),
    },
    getFramePostMessageTargetOrigin() ?? "*",
  );
  return true;
}

export function usePerAppChatState(enabled = true): AppChatSidebarState {
  const [state, setState] = useState<AppChatSidebarState>(() =>
    enabled ? readInitialPerAppChatState() : { open: false, hosted: false },
  );

  useEffect(() => {
    if (!enabled) return;

    const applyState = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      const next = value as Partial<AppChatSidebarState>;
      if (typeof next.open !== "boolean") return;
      setState({
        open: next.open,
        // Older hosts sent only `open`; a typed host-state message is still
        // enough to establish that the parent owns this app's chat.
        hosted: next.hosted !== false,
      });
    };
    const handleCustomEvent = (event: Event) => {
      applyState((event as CustomEvent<AppChatSidebarState>).detail);
    };
    const handleMessage = (event: MessageEvent) => {
      if (window.parent === window || event.source !== window.parent) return;
      if (event.data?.type !== APP_CHAT_SIDEBAR_STATE_MESSAGE) return;
      applyState(event.data.data);
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
  }, [enabled]);

  return state;
}

export function usePerAppChatOpen(): boolean {
  return usePerAppChatState().open;
}
